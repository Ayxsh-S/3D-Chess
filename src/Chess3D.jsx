import { Suspense, useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Chess } from "chess.js";

const FILES = "abcdefgh";
const SQUARE_SIZE_FALLBACK = 2;
const PIECE_VALUE = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000,
};

const PST = {
    p: [
         0,   0,   0,   0,   0,   0,   0,   0,
        50,  50,  50,  50,  50,  50,  50,  50,
        10,  10,  20,  30,  30,  20,  10,  10,
         5,   5,  10,  25,  25,  10,   5,   5,
         0,   0,   0,  20,  20,   0,   0,   0,
         5,  -5, -10,   0,   0, -10,  -5,   5,
         5,  10,  10, -20, -20,  10,  10,   5,
         0,   0,   0,   0,   0,   0,   0,   0,
    ],
    n: [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20,   0,   0,   0,   0, -20, -40,
        -30,   0,  10,  15,  15,  10,   0, -30,
        -30,   5,  15,  20,  20,  15,   5, -30,
        -30,   0,  15,  20,  20,  15,   0, -30,
        -30,   5,  10,  15,  15,  10,   5, -30,
        -40, -20,   0,   5,   5,   0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10,   0,   0,   0,   0,   0,   0, -10,
        -10,   0,   5,  10,  10,   5,   0, -10,
        -10,   5,   5,  10,  10,   5,   5, -10,
        -10,   0,  10,  10,  10,  10,   0, -10,
        -10,  10,  10,  10,  10,  10,  10, -10,
        -10,   5,   0,   0,   0,   0,   5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
         0,   0,   5,  10,  10,   5,   0,   0,
        -5,   0,   0,   0,   0,   0,   0,  -5,
        -5,   0,   0,   0,   0,   0,   0,  -5,
        -5,   0,   0,   0,   0,   0,   0,  -5,
        -5,   0,   0,   0,   0,   0,   0,  -5,
        -5,   0,   0,   0,   0,   0,   0,  -5,
         5,  10,  10,  10,  10,  10,  10,   5,
         0,   0,   0,   0,   0,   0,   0,   0,
    ],
    q: [
        -20, -10, -10,  -5,  -5, -10, -10, -20,
        -10,   0,   0,   0,   0,   5,   0, -10,
        -10,   0,   5,   5,   5,   5,   5, -10,
         -5,   0,   5,   5,   5,   5,   0,  -5,
          0,   0,   5,   5,   5,   5,   0,  -5,
        -10,   5,   5,   5,   5,   5,   0, -10,
        -10,   0,   5,   0,   0,   0,   0, -10,
        -20, -10, -10,  -5,  -5, -10, -10, -20,
    ],
    k: [
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -10, -20, -20, -20, -20, -20, -20, -10,
         20,  20,   0,   0,   0,   0,  20,  20,
         20,  30,  10,   0,   0,  10,  30,  20,
    ],
};

const OPENING_ROOK_PENALTY = -35;
const EARLY_QUEEN_PENALTY = -18;
const DEVELOPMENT_BONUS = 18;
const CENTER_CONTROL_BONUS = 10;
const KING_SAFETY_BONUS = 20;

function createInitialPieces() {
    const pieces = [];
    const add = (color, type, square, id) => pieces.push({ id, color, type, square });

    add("white", "r", "a1", "wr1");
    add("white", "n", "b1", "wn1");
    add("white", "b", "c1", "wb1");
    add("white", "q", "d1", "wq");
    add("white", "k", "e1", "wk");
    add("white", "b", "f1", "wb2");
    add("white", "n", "g1", "wn2");
    add("white", "r", "h1", "wr2");
    for (let i = 0; i < 8; i++) add("white", "p", `${FILES[i]}2`, `wp${i+1}`);

    add("black", "r", "a8", "br1");
    add("black", "n", "b8", "bn1");
    add("black", "b", "c8", "bb1");
    add("black", "q", "d8", "bq");
    add("black", "k", "e8", "bk");
    add("black", "b", "f8", "bb2");
    add("black", "n", "g8", "bn2");
    add("black", "r", "h8", "br2");
    for (let i = 0; i < 8; i++) add("black", "p", `${FILES[i]}7`, `bp${i+1}`);

    return pieces;
}

function getRankFile(square) {
    return {
        fileIdx: FILES.indexOf(square[0]),
        rankIdx: Number(square[1])-1,
    };
}

const killerMoves = Array.from({ length: 64 }, () => [null, null]);
const historyHeuristic = new Map();

function moveKey(m) {
    return `${m.from}${m.to}${m.promotion || ""}`;
}

function addHistory(move, depth) {
    const key = moveKey(move);
    historyHeuristic.set(key, (historyHeuristic.get(key) || 0) + depth * depth);
}

function isKiller(move, ply) {
    return killerMoves[ply]?.some((km) => km && sameMove(move, km));
}

function moveScore(m, ttMove, ply) {
    let score = 0;

    if (isKiller(m, ply)) score += 50_000;
    score += historyHeuristic.get(moveKey(m)) || 0;

    if (sameMove(m, ttMove)) score += 1000000;
    if (m.captured) score += PIECE_VALUE[m.captured]*10-PIECE_VALUE[m.piece];
    if (m.promotion) score += PIECE_VALUE[m.promotion]+900;
    if (m.flags?.includes("k") || m.flags?.includes("q")) score += 60;
    if (m.flags?.includes("c")) score += 30;
    if (m.san?.includes("+")) score+= 25
    if (m.san?.includes("#")) score += 10000;
    if (CENTER_SQUARES.has(m.to)) score += 18;
    if ((m.piece === "n" || m.piece === "b") && HOME_DEV_SQUARES[m.color]?.[m.piece]?.has(m.from)) {
        score += 12;
    }
    return score;
}

function orderMoves(moves, ttMove, ply) {
    return moves.sort((a, b) => moveScore(b, ttMove, ply) - moveScore(a, ttMove, ply));
}

function mirrorIdx(idx) {
    return 63-idx;
}

function squareIdx(square) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1])-1;
    return rank*8+file;
}

function getGamePhase(game) {
    let phase = 0;
    const board = game.board();

    for (const row of board) {
        for (const piece of row) {
            if (!piece) continue;
            if (piece.type === "q") phase += 4;
            else if (piece.type === "r") phase += 2;
            else if (piece.type === "b" || piece.type === "n") phase += 1;
        }
    }
    return Math.min(phase, 24); // 24 is opening, 0 is around end-game
}

function pieceSquareValue(piece, square) {
    const idx = squareIdx(square);
    const table = PST[piece.type];
    if (!table || idx < 0 || idx > 63) return 0;
    return piece.color === "w" ? table[idx] : table[mirrorIdx(idx)];
}


function evaluateBoard(game) {
    if (game.isCheckmate?.()) {
        return game.turn() === "w" ? -MATE_SCORE : MATE_SCORE;
    }

    if (game.isDraw?.() || game.isStalemate?.() || game.isThreefoldRepetition?.() || game.isInsufficientMaterial?.()) {
        return 0;
    }

    const board = game.board();
    const phase = getGamePhase(game);
    let score = 0;
    let whiteKingSquare = null;
    let blackKingSquare = null;

    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const piece = board[rank][file];
            if (!piece) continue;

            const square = `${FILES[file]}${8 - rank}`;
            const material = PIECE_VALUE[piece.type] || 0;
            const pst = pieceSquareValue(piece, square);

            score += piece.color === "w" ? material+pst : -(material+pst);

            if (piece.type === "k") {
                if (piece.color === "w") whiteKingSquare = square;
                else blackKingSquare = square;
            }

            if (piece.type === "q" && phase > 16) {
                const isEarlyQueen = HOME_DEV_SQUARES[piece.color]?.q?.has(square);
                if (isEarlyQueen) {
                    score += piece.color === "w" ? EARLY_QUEEN_PENALTY : -EARLY_QUEEN_PENALTY;
                }
            }

            if (piece.type === "r" && phase > 18) {
                const homeRank = (piece.color === "w" && square.endsWith("1")) || (piece.color === "b" && square.endsWith("8"));
                if (homeRank) {
                    score += piece.color === "w" ? OPENING_ROOK_PENALTY : -OPENING_ROOK_PENALTY;
                }
            }

            if ((piece.type === "n" || piece.type === "b") && !HOME_DEV_SQUARES[piece.color]?.[piece.type]?.has(square)) {
                score += piece.color === "w" ? DEVELOPMENT_BONUS : -DEVELOPMENT_BONUS;
            }

            if (CENTER_SQUARES.has(square)) {
                score += piece.color === "w" ? CENTER_CONTROL_BONUS : -CENTER_CONTROL_BONUS;
            }
        }
    }


    if (whiteKingSquare === "g1" || whiteKingSquare === "c1") score += KING_SAFETY_BONUS;
    if (blackKingSquare === "g8" || blackKingSquare === "c8") score -= KING_SAFETY_BONUS;

    return score;
}

const OPENING_BOOK = {
    "": ["e4", "d4", "c4", "Nf3"],

    // 1. e4
    "e4": ["e5", "c5", "e6", "c6"],
    "e4 e5": ["Nf3", "Nc3"],
    "e4 e5 Nf3": ["Nc6", "Nf6", "d6"],
    "e4 e5 Nf3 Nc6": ["Bb5", "Bc4", "Nc3", "d4"],

    // Ruy Lopez
    "e4 e5 Nf3 Nc6 Bb5": ["a6"],
    "e4 e5 Nf3 Nc6 Bb5 a6": ["Ba4", "Bxc6"],
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4": ["Nf6"],
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6": ["O-O"],

    // Italian / Scotch-ish
    "e4 e5 Nf3 Nc6 Bc4": ["Bc5", "Nf6"],
    "e4 e5 Nf3 Nc6 Nc3": ["Nf6", "Bb4"],

    // Sicilian
    "e4 c5": ["Nf3", "c3", "d4"],
    "e4 c5 Nf3": ["d6", "Nc6", "e6"],
    "e4 c5 Nf3 d6": ["d4", "Nc3"],
    "e4 c5 Nf3 Nc6": ["Nc3", "d4"],
    "e4 c5 Nf3 e6": ["d4"],
    "e4 c5 Nf3 d6 d4": ["cxd4"],
    "e4 c5 Nf3 d6 d4 cxd4": ["Nxd4"],
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4": ["Nf6", "a6"],

    // French
    "e4 e6": ["d4"],
    "e4 e6 d4": ["d5", "Nf6"],
    "e4 e6 d4 d5": ["Nc3", "Nd2"],
    "e4 e6 d4 d5 Nc3": ["Bb4", "Nf6"],

    // Caro-Kann
    "e4 c6": ["d4"],
    "e4 c6 d4": ["d5"],
    "e4 c6 d4 d5": ["Nc3", "Nd2"],

    // 1. d4
    "d4": ["d5", "Nf6"],
    "d4 d5": ["c4", "Nf3", "e3"],
    "d4 d5 c4": ["e6", "c6", "dxc4"],
    "d4 d5 c4 e6": ["Nc3", "Nf3"],
    "d4 d5 c4 e6 Nc3": ["Nf6", "Be7"],

    // Indian defenses
    "d4 Nf6": ["c4", "Nf3", "g3"],
    "d4 Nf6 c4": ["g6", "e6", "c5"],
    "d4 Nf6 c4 g6": ["Nc3", "Nf3", "g3"],
    "d4 Nf6 c4 g6 Nc3": ["Bg7"],

    // English / flank openings
    "c4": ["e5", "Nf6", "c5", "e6"],
    "c4 e5": ["Nc3", "g3"],
    "Nf3": ["d5", "Nf6", "g6", "c5"],
    "Nf3 d5": ["g3", "c4"],
    "Nf3 Nf6": ["c4", "g3", "d4"]
};


function chooseOpeningMove(game) {
    const history = game.history();
    if (history.length > 12) return null;

    const legalMoves = game.moves({ verbose: true });

    for (let len = history.length; len >= 0; len--) {
        const key = history.slice(0, len).join(" ");
        const options = OPENING_BOOK[key];
        if (!options?.length) continue;

        const candidates = legalMoves.filter((move) => options.includes(move.san));
        if (candidates.length) {
            return candidates[Math.floor(Math.random() * candidates.length)];
        }
    }

    return null;
}

function ttStore(game, depth, value, flag, bestMove) {
    if (TT.size > TT_MAX_SIZE) TT.clear();

    TT.set(normaliseFen(game.fen()), {
        depth, 
        value,
        flag,
        bestMove,
    });
}

function quiescence(game, alpha, beta, color, deadline, limits) {
    if (deadline && performance.now() > deadline) throw new Error("SEARCH_TIMEOUT");
    if (++limits.nodes > MAX_SEARCH_NODES) throw new Error("SEARCH_TIMEOUT");

    let standPat = color * evaluateBoard(game);
    if (standPat >= beta) return { value: beta };
    if (standPat > alpha) alpha = standPat;

    const moves = game.moves({ verbose: true }).filter(
        (m) => m.captured || m.promotion || m.san?.includes("+") || m.san?.includes("#")
    );

    for (const move of moves) {
        game.move({ from: move.from, to: move.to, promotion: move.promotion });
        try {
            const score = -quiescence(game, -beta, -alpha, -color, deadline, limits).value;
            if (score >= beta) return { value: beta };
            if (score > alpha) alpha = score;
        } finally {
            game.undo();
        }
    }

    return { value: alpha };
}

function negamax(game, depth, alpha, beta, color, deadline, limits, ply = 0) {
    if (deadline && performance.now() > deadline) {
        return quiescence(game, alpha, beta, color, deadline, limits);
    }

    if (++limits.nodes > MAX_SEARCH_NODES) {
        throw new Error("SEARCH_TIMEOUT");
    }

    const ttEntry = ttLookup(game);

    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === "exact") {
            return { value: ttEntry.value, bestMove: ttEntry.bestMove };
        }
        if (ttEntry.flag === "lower" && ttEntry.value >= beta) {
            return { value: ttEntry.value, bestMove: ttEntry.bestMove };
        }
        if (ttEntry.flag === "upper" && ttEntry.value <= alpha) {
            return { value: ttEntry.value, bestMove: ttEntry.bestMove };
        }
    }

    if (depth <= 0 || game.isGameOver?.()) {
        return { value: color*evaluateBoard(game), bestMove: null };
    }

    const rawMoves = game.moves({ verbose: true });
    if (!rawMoves.length) {
        return { value: color*evaluateBoard(game), bestMove: null };
    }

    const moves = orderMoves(rawMoves, ttEntry?.bestMove || null, ply);

    let bestValue = -Infinity;
    let bestMove = null;
    const alphaOrig = alpha;

    for (const move of moves) {
        game.move({ from: move.from, to: move.to, promotion: move.promotion });
        try {
            const child = negamax(game, depth - 1, -beta, -alpha, -color, deadline, limits);
            const score = -child.value;

            if (score > bestValue) {
                bestValue = score;
                bestMove = move;
            }

            alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
        } finally {
            game.undo();
        }
    }

    let flag = "exact";
    if (bestValue <= alphaOrig) flag = "upper";
    else if (bestValue >= beta) flag = "lower";

    ttStore(game, depth, bestValue, flag, bestMove);

    return { value: bestValue, bestMove };
}

const CENTER_SQUARES = new Set(["d4", "e4", "d5", "e5"]);
const HOME_DEV_SQUARES = {
    w: {
        n: new Set(["b1", "g1"]),
        b: new Set(["c1", "f1"]),
        q: new Set(["d1"]),
    },
    b: {
        n: new Set(["b8", "g8"]),
        b: new Set(["c8", "f8"]),
        q: new Set(["d8"]),
    },
};

const MATE_SCORE = 1000000;
const TT = new Map();
const TT_MAX_SIZE = 50000;
const MAX_SEARCH_NODES = 25000;

function sameMove(a, b) {
    return !!b && 
                a.from === b.from && 
                a.to === b.to && 
                (a.promotion || "") === (b.promotion || "");
}

function ttLookup(game) {
    return TT.get(normaliseFen(game.fen())) || null;
}

function normaliseFen(fen) {
    return fen.split(" ").slice(0, 4).join(" ");
}

// function minimax(game, depth, alpha, beta) {
//     const key = `${game.fen()}|${depth}|${alpha}|${beta}`;
//     if (TT.has(key)) return TT.get(key);

//     if (depth <= 0 || game.isGameOver?.()) {
//         const evalScore =  evaluateBoard(game);
//         TT.set(key, evalScore);
//         return evalScore;
//     }

//     const moves = orderMoves(game.moves({ verbose: true }));

//     let best;

//     if (game.turn() === "w") {
//         best = -Infinity;
//         for (const move of moves) {
//             game.move({ from: move.from, to: move.to, promotion: move.promotion });
//             const score = minimax(game, depth-1, alpha, beta);
//             game.undo();
//             best = Math.max(best, score);
//             alpha = Math.max(alpha, best);
//             if (beta <= alpha) break;
//         }
//     } else {
//         best = Infinity;
//         for (const move of moves) {
//             game.move({ from: move.from, to: move.to, promotion: move.promotion });
//             const score = minimax(game, depth-1, alpha, beta);
//             game.undo();
//             best = Math.min(best, score);
//             beta = Math.min(beta, best);
//             if (beta <= alpha) break;
//         }
//     }
//     TT.set(key, best);
//     return best;
// }

function findBestMove(game, depth) {
    const bookMove = chooseOpeningMove(game);
    if (bookMove) return bookMove;

    const moves = orderMoves(game.moves({ verbose: true }));
    if (!moves.length) return null;

    const timeLimitMs = depth >= 3 ? 1200 : 700;
    const deadline = performance.now() + timeLimitMs;

    let bestMove = null;

    for (let d = 1; d <= depth; d++) {
        const limits = { nodes: 0 };
        try {
            const res = negamax(game, d, -Infinity, Infinity, game.turn() === "w" ? 1 : -1, deadline, limits, 0);
            if (res.bestMove) {
                bestMove = res.bestMove;
            }
        } catch (e) {
            if (e?.message === "SEARCH_TIMEOUT") {
                break;
            }
            throw e;
        }
    }
    return bestMove || moves[0];
}

// function repetitionPenalty(game) {
//     const history = game.history();
//     if (history.length < 6) return 0;
//     const last = history[history.length-1];
//     let count = 0;
//     for (let i = history.length-1; i >= 0; i--) {
//         if (history[i] === last) count++;
//         if (count >= 2) break;
//     }
   
//     return count > 1 ? -25 : 0;
// }

function getTemplateMap(nodes) {
    return {
        white: {
            p: [nodes["Circle_Coppper_0"], nodes["Circle_white_0"]],
            r: [nodes["Circle031_Coppper_0"], nodes["Circle031_white_0"]],
            n: [nodes["Circle033_Coppper_0"], nodes["Circle033_white_0"]],
            b: [nodes["Circle032_Coppper_0"], nodes["Circle032_white_0"]],
            k: [nodes["Circle008_Coppper_0"], nodes["Circle008_white_0"]],
            q: [nodes["Circle007_Coppper_0"], nodes["Circle007_white_0"]],
        },
        black: {
            p: [nodes["Circle011_Coppper_0"], nodes["Circle011_black_0"]],
            r: [nodes["Circle036_Coppper_0"], nodes["Circle036_black_0"]],
            n: [nodes["Circle034_Coppper_0"], nodes["Circle034_black_0"]],
            b: [nodes["Circle028_Coppper_0"], nodes["Circle028_black_0"]],
            k: [nodes["Circle029_Coppper_0"], nodes["Circle029_black_0"]],
            q: [nodes["Circle035_Coppper_0"], nodes["Circle035_black_0"]],
        },
    };
}

function useModelMetrics(nodes) {
    return useMemo(() => {
        const geom = 
            nodes?.["Plane_light_0"]?.geometry ||
            nodes?.["Plane_dark_0"]?.geometry ||
            nodes?.["Plane_gold_0"]?.geometry;
        if (!geom) {
            return {
                ready: false,
                minX: -7,
                minY: 2,
                square: SQUARE_SIZE_FALLBACK,
                topZ: -3.4,
            };
        }

        if (!geom.boundingBox) {
            geom.computeBoundingBox();
        }

       const box = geom.boundingBox.clone();
       const size = new THREE.Vector3();
       box.getSize(size);

        return {
            ready: true,
            minX: box.min.x,
            minY: box.min.y,
            square: size.x/8,
            topZ: box.max.z+0.08,
        };
    }, [nodes]);
}

const PieceModel = memo(function PieceModel({ object, position, onClick }) {
    const instance = useMemo(() => object.clone(true), [object]);
    return (
        <group
            position={position}
            onClick={(e) => {
                e.stopPropagation();
                onClick?.();
            }}
        >
            <primitive object={instance} />
        </group>
    );
});

const MODEL_ROTATION = [-Math.PI/2, 0, 0];
const MODEL_POSITION = [-7.6072488, -18.6398945, -4.616249];
const BOARD_TARGET = [-7.6072488, -18.6398945, -4.616249];
const CAMERA_POS = [-8, 5, 40];

function makeReusablePieceTemplate(objects) {
    const group = new THREE.Group();

    objects.filter(Boolean).forEach((obj) => group.add(obj.clone(true)));

    group.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());

    group.position.sub(center);

    return {
        object: group,
        height: box.getSize(new THREE.Vector3()).z,
    };
}

function toVisualCoords(fileIdx, rankIdx, orientation) {
    if (orientation === "white") {
        return { file: fileIdx, rank: rankIdx };
    }
    return { file: 7 - fileIdx, rank: 7 - rankIdx };
}

function ChessBoardScene({ pieces, selectedSquare, legalSquares, lastMove, orientation, onSquareClick} ) {
    const { nodes } = useGLTF("/chess.glb");
    const metrics = useModelMetrics(nodes);
    const templateMap = useMemo(() => getTemplateMap(nodes), [nodes]);

    // console.log(Object.keys(nodes));

    // useEffect(() => {
    //     const matteBoard = (root) => {
    //         if (!root) return;
    //         root.traverse((obj) => {
    //             if (!obj.isMesh || !obj.material) return;

    //             const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    //             materials.forEach((mat) => {
    //                 if (!mat) return;
    //                 mat.roughness = 1;
    //                 mat.metalness = 0;
    //                 mat.envMapIntensity = 0;
    //                 mat.needsUpdate = true;
    //             });
    //         });
    //     };

    //     matteBoard(nodes.Board);
    //     matteBoard(nodes.Board_Under);
    // }, [nodes]);

    const pieceInfo = useMemo(() => {
        const info = {};
        for (const color of ["white", "black"]) {
            for (const type of ["p", "r", "n", "b", "q", "k"]) {
                const template = templateMap[color][type];
                if (!template) continue;

                const prepared = makeReusablePieceTemplate(template);
                if (!prepared) continue

                info[`${color}-${type}`] = prepared;
            }
        }
        return info;
    }, [templateMap]);

    const boardSquares = useMemo(() => {
        const squares = [];
        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const square = `${FILES[file]}${rank+1}`;

                // const x = metrics.minX+metrics.square/2+shownFile*metrics.square;
                // const y = metrics.minY+metrics.square/2+shownRank*metrics.square;
                const { file: visFile, rank: visRank } = toVisualCoords(file, rank, orientation);
                const x = metrics.minX+metrics.square/2+visFile*metrics.square;
                const y = metrics.minY+metrics.square/2+visRank*metrics.square;


                const isSelected = selectedSquare === square;
                const isLegal = legalSquares.includes(square);
                const isLastFrom = lastMove?.from === square;
                const isLastTo = lastMove?.to === square;
                const showOverlay = isSelected || isLegal || isLastFrom || isLastTo;

                squares.push(
                    <group key={square}>
                        <mesh
                            position={[x, y, metrics.topZ+0.01]}
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                onSquareClick(square);
                            }}
                        >
                             <planeGeometry args={[metrics.square, metrics.square]} />
                            <meshStandardMaterial 
                                transparent
                                opacity={0}
                                depthWrite={false}
                            />
                        </mesh>

                        {/* {showOverlay ? (
                            <mesh position={[x, y, metrics.topZ]}>
                                <boxGeometry args={[metrics.square*0.92, 0.015, metrics.square*0.92]} />
                                <meshStandardMaterial 
                                    transparent
                                    opacity={isSelected ? 0.42 : isLegal ? 0.28 : 0.18}
                                    color={isSelected ? "#facc15" : isLegal ? "#22c55e" : "#60a5fa"}
                                    depthWrite={false}
                                />
                            </mesh>
                        ) : null} */}

                        {showOverlay ? (
                            <>
                                {isSelected && (
                                    <mesh position={[x, y, metrics.topZ+0.03]} renderOrder={20}>
                                        <ringGeometry 
                                            args={[
                                                metrics.square*0.33,
                                                metrics.square*0.5,
                                                48
                                            ]}
                                        />

                                        <meshBasicMaterial 
                                            color="#facc15"
                                            transparent
                                            opacity={0.95}
                                            depthWrite={false}
                                        />
                                    </mesh>
                                )}
                                {isLegal && !isSelected && (
                                    <mesh position={[x, y, metrics.topZ+0.025]} renderOrder={20}>
                                        <circleGeometry args={[metrics.square*0.16, 32]} />
                                        <meshBasicMaterial
                                            color="#22c55e"
                                            transparent
                                            opacity={0.9}
                                            depthWrite={false}
                                        />
                                    </mesh>
                                )}

                                {(isLastFrom || isLastTo) && (
                                    <group position={[x, y, metrics.topZ+0.02]} renderOrder={999}>
                                        {isLastTo && (
                                            <>
                                                <mesh renderOrder={1000}>
                                                    <ringGeometry 
                                                        args={[
                                                            metrics.square*0.3,
                                                            metrics.square*0.42,
                                                            64
                                                        ]}
                                                    />

                                                    <meshBasicMaterial
                                                        color="#40c2fe"
                                                        transparent
                                                        opacity={0.8}
                                                        depthWrite={false}
                                                        depthTest={false}
                                                    />
                                                </mesh>

                                                <mesh position={[0, 0.002, 0]} renderOrder={1000}>
                                                    <circleGeometry args={[metrics.square*0.28, 48]} />
                                                    <meshBasicMaterial
                                                        color="#38bdf8"
                                                        transparent
                                                        opacity={0.05}
                                                        depthTest={false}
                                                        depthWrite={false}
                                                    />
                                                </mesh>
                                            </>
                                        )}
                                        {isLastFrom && (
                                            <mesh renderOrder={1000}>
                                                <ringGeometry args={[metrics.square*0.36, metrics.square*0.46, 64]} />
                                                <meshBasicMaterial 
                                                    color="#53ccfc"
                                                    transparent
                                                    opacity={0.6}
                                                    depthWrite={false}
                                                />
                                            </mesh>
                                        )}        
                                    </group>
                                )}
                            </>
                        ) : null}
                    </group>
                );
            }
        }
        return squares;
    }, [orientation, metrics, selectedSquare, legalSquares, lastMove, onSquareClick]);

    return (
        <group rotation={MODEL_ROTATION} position={MODEL_POSITION}>
            <primitive object={nodes["Plane_Shedua_0"]} />
            <primitive object={nodes["Plane_gold_0"]} />
            <primitive object={nodes["Plane_dark_0"]} />
            <primitive object={nodes["Plane_light_0"]} />

            {boardSquares}

            {pieces.map((piece) => {
                const info = pieceInfo[`${piece.color}-${piece.type}`];
                if (!info) return null;

                const { fileIdx, rankIdx } = getRankFile(piece.square);
                // const shownFile = orientation === "white" ? fileIdx : 7-fileIdx;
                // const shownRank = orientation === "white" ? rankIdx : 7-rankIdx;
                // const position = new THREE.Vector3(
                //     metrics.minX+metrics.square/2+shownFile*metrics.square,
                //     metrics.minY+metrics.square/2+shownRank*metrics.square,
                //     metrics.topZ + 0.01 + info.height / 2
                // );

                const { file, rank } = toVisualCoords(fileIdx, rankIdx, orientation);
                const position = new THREE.Vector3(
                    metrics.minX+metrics.square/2 +file*metrics.square,
                    metrics.minY+metrics.square/2+rank*metrics.square,
                    metrics.topZ+0.01+info.height/2
                );

                return (
                    <PieceModel 
                        key={piece.id}
                        object={info.object}
                        position={position}
                        onClick={() => onSquareClick(piece.square)}
                    />
                );
            })}
        </group>
    );
}

function statusText(game) {
    if (game.isCheckmate?.()) {
        return `Checkmate - ${game.turn() === "w" ? "Black" : "White"} wins`;
    }

    if (game.isDraw?.() || game.isStalemate?.() || game.isThreefoldRepetition?.() || game.isInsufficientMaterial?.()) {
        return "Draw";
    }

    const side = game.turn() === "w" ? "White" : "Black";
    const check = game.isCheck?.() ? " - check" : "";
    return `${side} to move${check}`;
}


function CameraControl() {
    const controls = useRef();
    const { invalidate } = useThree();

    return (
        <OrbitControls
            ref={controls}
            makeDefault
            target={BOARD_TARGET}
            enablePan={false}
            enableDamping
            dampingFactor={0.05}
            rotateSpeed={1}
            zoomSpeed={0.6}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI/2}
            minDistance={30}
            maxDistance={80}
            onStart={invalidate}
            onChange={invalidate}
            onEnd={invalidate}
        />
    );
}

export default function Chess3D() {
    const gameRef = useRef(new Chess());
    const [fen, setFen] = useState(gameRef.current.fen());
    const [pieces, setPieces] = useState(createInitialPieces());
    const [selectedSquare, setSelectedSquare] = useState(null);
    const [legalSquares, setLegalSquares] = useState([]);
    const [lastMove, setLastMove] = useState(null);
    const [mode, setMode] = useState("ai");
    const [humanColor, setHumanColor] = useState("white");
    const [orientation, setOrientation] = useState("white");
    const [aiDepth, setAiDepth] = useState(2);
    const [status, setStatus] = useState("White to move");
    const [capturedPieces, setCapturedPieces] = useState({
        white: [],
        black: [],
    });

    const capturedSvg = {
        p: "/pieces/pawn.svg",
        r: "/pieces/rook.svg",
        n: "/pieces/knight.svg",
        b: "/pieces/bishop.svg",
        q: "/pieces/queen.svg",
        k: "/pieces/king.svg",
    };

    const applyMove = useCallback((moveLike) => {
        const game = gameRef.current;
        const moveInput = { from: moveLike.from, to: moveLike.to };
        if (moveLike.promotion) moveInput.promotion = moveLike.promotion;
        const move = game.move(moveInput);
        if (!move) return false;
        
        if (move.captured) {
            const capturedColor = move.color === "w" ? "black" : "white";
            const capturer = move.color === "w" ? "white" : "black";

            setCapturedPieces((prev) => ({
                ...prev,
                [capturer]: [
                    ...prev[capturer],
                    {
                        id: `${capturedColor}-${move.captured}-${Date.now()}-${Math.random()}`,
                        color: capturedColor,
                        type: move.captured,
                    },
                ],
            }));
        }

        setPieces((prev) => {
            const next = prev.map((p) => ( { ...p }));

            if (move.captured && !move.flags.includes("e")) {
                const idx = next.findIndex((p) => p.square === move.to);
                if (idx >= 0) {
                    next.splice(idx, 1);
                }
            }

            if (move.flags.includes("e")) {
                const capturedSquare = `${move.to[0]}${move.from[1]}`;
                const idx = next.findIndex((p) => p.square === capturedSquare);
                if (idx >= 0) {
                    next.splice(idx, 1);
                }
            }

            if (move.flags.includes("k") || move.flags.includes("q")) {
                const rank = move.color === "w" ? "1" : "8";
                const rookFrom = move.flags.includes("k") ? `h${rank}` : `a${rank}`;
                const rookTo = move.flags.includes("k") ? `f${rank}` : `d${rank}`;
                const rook = next.find((p) => p.square === rookFrom && p.color === (move.color === "w" ? "white" : "black"));
                if (rook) rook.square = rookTo;
            }

            const mover = next.find((p) => p.square === move.from && p.color === (move.color === "w" ? "white" : "black"));
            if (mover) {
                mover.square = move.to;
                if (move.promotion) mover.type = move.promotion;
            }

            return next;
        });

        setSelectedSquare(null);
        setLegalSquares([]);
        setLastMove({ from: move.from, to: move.to });
        setFen(game.fen());
        return true;
    }, []);

    const resetGame = () => {
        searchTokenRef.current++;
        TT.clear();
        gameRef.current = new Chess();
        setPieces(createInitialPieces());
        setSelectedSquare(null);
        setLegalSquares([]);
        setLastMove(null);
        setFen(gameRef.current.fen());
        setStatus("White to move");
        setCapturedPieces({ white: [], black: [] });
        if (mode === "ai") {
            setOrientation(humanColor);
        } else {
            setOrientation("white");
        }
    };

    const searchTokenRef = useRef(0);

    useEffect(() => {
        const game = gameRef.current;
        setStatus(statusText(game));

        if (mode !== "ai") return;
        if (game.isGameOver?.()) return;

        const aiTurn = humanColor === "white" ? "b" : "w";
        if (game.turn() !== aiTurn) return;

        const token = ++searchTokenRef.current;
        const fenAtStart = game.fen();

        const timer = window.setTimeout(() => {
            const curr = gameRef.current;
            if (token !== searchTokenRef.current) return;
            if (curr.fen() !== fenAtStart) return;
            if (curr.isGameOver?.()) return;
            const best = findBestMove(curr, aiDepth);
            if (best && token === searchTokenRef.current && curr.fen() === fenAtStart) {
                applyMove(best);
            }
        }, 100);
        return () => window.clearTimeout(timer);
    }, [fen, mode, humanColor, aiDepth, applyMove]);

    useEffect(() => {
        if (mode === "ai") {
            setOrientation(humanColor);
        }
    }, [mode, humanColor]);

    const handleSquareClick = useCallback((square) => {
        const game = gameRef.current;
        if (game.isGameOver?.()) return;

        const sideToMove = game.turn() === "w" ? "white" : "black";

        if (mode === "ai" && sideToMove !== humanColor) return;

        const pieceOnSquare = pieces.find((p) => p.square === square);

        if (selectedSquare) {
            const legalMoves = game.moves({ square: selectedSquare, verbose: true });
            const targetMove = legalMoves.find(
                (m) => m.to === square && m.promotion === "q"
            ) || legalMoves.find((m) => m.to === square);

            if (targetMove) {
                applyMove({
                    from: selectedSquare,
                    to: square,
                    promotion: targetMove.promotion,
                });
                return
            }
        }    

        if (pieceOnSquare && pieceOnSquare.color === sideToMove) {
            setSelectedSquare(square);
            const legal = game.moves({ square, verbose: true });
            setLegalSquares(legal.map((m) => m.to));
            return;
        }
            
        setSelectedSquare(null);
        setLegalSquares([]);
    }, [applyMove, humanColor, mode, pieces, selectedSquare]);

    return (
        <div className="container">
            <div className="sub-container">
                <Canvas
                    frameloop="demand"
                    dpr={[1, 2]}
                    camera={{ position: CAMERA_POS, fov: 45, near: 0.1, far: 200 }}
                    gl={{ 
                        antialias: false,
                        toneMapping: THREE.ACESFilmicToneMapping,
                        toneMappingExposure: 1.0,
                        outputColorSpace: THREE.SRGBColorSpace,
                        powerPreference: "high-performance",
                        alpha: false,
                    }}
                >
                    <color attach="background" args={["#101317"]} />
                    <Environment preset="sunset" background={false} resolution={4} blur={1} />
                    {/* {/* <ambientLight intensity={0.35} /> */}
                    {/* <hemisphereLight intensity={1} groundColor="#dedede" /> */}
                    {/* <directionalLight position={[10, 18, 12]} intensity={5}/> */}
                    {/* <directionalLight position={[-6, 6, -8]} intensity={0.25} />  */}
                    <Suspense fallback={null}>
                        <ChessBoardScene
                            pieces={pieces}
                            selectedSquare={selectedSquare}
                            legalSquares={legalSquares}
                            lastMove={lastMove}
                            orientation={orientation}
                            onSquareClick={handleSquareClick}
                        />
                    </Suspense>
                    <CameraControl />
                </Canvas>
                <div className="status">
                    {status}
                </div>
                <div className="captured-overlay">
                    <div className="captured-box">
                        <div className="captured-title">White</div>
                        <div className="captured-row">
                            {capturedPieces.white.map((p) => (
                                <span key={p.id} className={`captured-piece ${p.color}`}>
                                    <img src={capturedSvg[p.type]}
                                        alt={`${p.type}`}
                                        className="captured-piece-img"
                                    />
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="captured-box">
                        <div className="captured-title">Black</div>
                        <div className="captured-row">
                            {capturedPieces.black.map((p) => (
                                <span key={p.id} className={`captured-piece ${p.color}`}>
                                    <img src={capturedSvg[p.type]}
                                        alt={`${p.type}`}
                                        className="captured-piece-img"
                                    />
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <aside className="sidebar">
                <div>
                    <div className="big">3D Chess</div>
                </div>
                <div className="pane-style">
                    <div className="label-style">Mode</div>
                    <div className="row-style">
                        <button className={`control-btn ${mode === "ai" ? "active" : ""}`} onClick={() => setMode("ai")}>Vs AI</button>
                        <button className={`control-btn ${mode === "pvp" ? "active" : ""}`} onClick={() => setMode("pvp")}>2 Player</button>
                    </div>
                </div>

                <div className="panel-style">
                    <div className="label-style">Side</div>
                    <div className="row-style">
                        <button
                            className={`control-btn ${humanColor === "white" ? "active" : ""}`}
                            onClick={() => {
                                setHumanColor("white")
                                if (mode === "ai") setOrientation("white");
                            }}
                        >
                            White
                        </button>
                        <button
                            className={`control-btn ${humanColor === "black" ? "active" : ""}`}
                            onClick={() => {
                                setHumanColor("black")
                                if (mode === "ai") setOrientation("black");
                            }}
                        >
                            Black
                        </button>
                    </div>
                </div>

                <div className="panel-style">
                    <div className="label-style">AI difficulty</div>
                    <select 
                        className="select-style"
                        value={aiDepth}
                        onChange={(e) => setAiDepth(Number(e.target.value))}
                    >
                        <option value={1}>Very easy</option>
                        <option value={2}>Easy</option>
                        <option value={3}>Medium</option>
                    </select>
                </div>

                <div className="panel-style">
                    <div className="label-style">Board</div>
                    <div className="row-style">
                        <button
                            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
                        >
                            Flip board
                        </button>
                        <button onClick={resetGame}>Reset</button>
                    </div>
                </div>

                <div className="panel-style">
                    <div className="label-style">How it works</div>
                    <div className="hint">Drag board to rotate. Click a piece, then click a highlighted square. Promotion auto-chooses queen. The AI is a built-in minimax engine.
                        <br></br>
                        <a className="muted-link" href="https://sketchfab.com/3d-models/chess-e54c2d04d4f74823b69ba4a794fb4500" target="_blank" rel="noreferrer">Model by Verfassen</a>
                    </div>
                </div>
            </aside>
        </div>
    );
}

useGLTF.preload("/chess.glb");