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

function moveScore(m) {
    let score = 0;
    if (m.captured) score += PIECE_VALUE[m.captured]*10-PIECE_VALUE[m.piece];
    if (m.promotion) score += PIECE_VALUE[m.promotion]+50;
    if (m.flags?.includes("k") || m.flags?.includes("q")) score += 30;
    return score;
}

function orderMoves(moves) {
    return [...moves].sort((a, b) => moveScore(b)-moveScore(a));
}

function evaluateBoard(game) {
    if (game.isCheckmate?.()) {
        return game.turn() === "w" ? -999999 : 999999;
    }

    if (game.isDraw?.() || game.isStalemate?.() || game.isThreefoldRepetition?.() || game.isInsufficientMaterial?.()) {
        return 0;
    }

    let score = 0;
    const board = game.board();

    for (const row of board) {
        for (const piece of row) {
            if (!piece) continue;
            const value = PIECE_VALUE[piece.type] || 0;
            score += piece.color === "w" ? value : -value;
        }
    }

    return score;
}

function minimax(game, depth, alpha, beta) {
    if (depth <= 0 || game.isGameOver?.()) {
        return evaluateBoard(game);
    }

    const moves = orderMoves(game.moves({ verbose: true }));

    if (game.turn() === "w") {
        let best = -Infinity;
        for (const move of moves) {
            game.move({ from: move.from, to: move.to, promotion: move.promotion });
            const score = minimax(game, depth-1, alpha, beta);
            game.undo();
            best = Math.max(best, score);
            alpha = Math.max(alpha, best);
            if (beta <= alpha) break;
        }
        return best;
    }

    let best = Infinity;
    for (const move of moves) {
        game.move({ from: move.from, to: move.to, promotion: move.promotion });
        const score = minimax(game, depth-1, alpha, beta);
        game.undo();
        best = Math.min(best, score);
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
    }
    return best;
}

function findBestMove(game, depth) {
    const moves = orderMoves(game.moves({ verbose: true }));
    if (!moves.length) return null;

    const whiteToMove = game.turn() === "w";
    let bestMove = moves[0];
    let bestScore = whiteToMove ? -Infinity : Infinity;

    for (const move of moves) {
        game.move({ from: move.from, to: move.to, promotion: move.promotion });
        const score = minimax(game, depth-1, -Infinity, Infinity);
        game.undo();

        if ((whiteToMove && score > bestScore) || (!whiteToMove && score < bestScore)) {
            bestScore = score;
            bestMove = move;
        }
    }

    return bestMove;
}

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
                const shownFile = orientation === "white" ? file : 7-file;
                const shownRank = orientation === "white" ? rank : 7-rank;
                const square = `${FILES[file]}${rank+1}`;
                const x = metrics.minX+metrics.square/2+shownFile*metrics.square;
                const y = metrics.minY+metrics.square/2+shownRank*metrics.square;
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
                                                metrics.square*0.34,
                                                metrics.square*0.46,
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
                                                        color="#7dd3fc"
                                                        transparent
                                                        opacity={0.55}
                                                        depthWrite={false}
                                                        depthTest={false}
                                                    />
                                                </mesh>

                                                <mesh position={[0, 0.002, 0]} renderOrder={1000}>
                                                    <circleGeometry args={[metrics.square*0.28, 48]} />
                                                    <meshBasicMaterial
                                                        color="#38bdf8"
                                                        transparent
                                                        opacity={0.12}
                                                        depthTest={false}
                                                        depthWrite={false}
                                                    />
                                                </mesh>
                                            </>
                                        )}
                                        {isLastFrom && (
                                            <mesh renderOrder={1000}>
                                                <ringGeometry args={[metrics.square*0.42, metrics.square*0.46, 64]} />
                                                <meshBasicMaterial 
                                                    color="#93c5fd"
                                                    transparent
                                                    opacity={0.55}
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
                const shownFile = orientation === "white" ? fileIdx : 7-fileIdx;
                const shownRank = orientation === "white" ? rankIdx : 7-rankIdx;
                const position = new THREE.Vector3(
                    metrics.minX+metrics.square/2+shownFile*metrics.square,
                    metrics.minY+metrics.square/2+shownRank*metrics.square,
                    metrics.topZ + 0.01 + info.height / 2
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

    const applyMove = useCallback((moveLike) => {
        const game = gameRef.current;
        const moveInput = { from: moveLike.from, to: moveLike.to };
        if (moveLike.promotion) moveInput.promotion = moveLike.promotion;
        const move = game.move(moveInput);
        if (!move) return false;

        setPieces((prev) => {
            const next = prev.map((p) => ( { ...p }));

            const removeAt = (square) => {
                const idx = next.findIndex((p) => p.square === square);
                if (idx >= 0) next.splice(idx, 1);
            };

            if (move.captured && !move.flags.includes("e")) {
                removeAt(move.to);
            }

            if (move.flags.includes("e")) {
                const capturedSquare = `${move.to[0]}${move.from[1]}`;
                removeAt(capturedSquare);
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
        gameRef.current = new Chess();
        setPieces(createInitialPieces());
        setSelectedSquare(null);
        setLegalSquares([]);
        setLastMove(null);
        setFen(gameRef.current.fen());
        setStatus("White to move");
        if (mode === "ai") {
            setOrientation(humanColor);
        } else {
            setOrientation("white");
        }
    };

    useEffect(() => {
        const game = gameRef.current;
        setStatus(statusText(game));

        if (mode !== "ai") return;
        if (game.isGameOver?.()) return;

        const aiTurn = humanColor === "white" ? "b" : "w";
        if (game.turn() !== aiTurn) return;

        const timer = window.setTimeout(() => {
            const curr = gameRef.current;
            if (curr.isGameOver?.()) return;
            const best = findBestMove(curr, aiDepth);
            if (best) {
                applyMove(best);
            }
        }, 350);
        return () => window.clearTimeout(timer);
    }, [fen, mode, humanColor, aiDepth]);

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
                    dpr={[1, 1.5]}
                    camera={{ position: CAMERA_POS, fov: 40, near: 0.1, far: 200 }}
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
            </div>

            <aside className="sidebar">
                <div>
                    <div className="big">3D Chess</div>
                </div>
                <div className="pane-style">
                    <div className="label-style">Mode</div>
                    {/* need some fixes herre */}
                    <div className="row-style">
                        <button className="" onClick={() => setMode("ai")}>Vs AI</button>
                        <button className="" onClick={() => setMode("pvp")}>2 Player</button>
                    </div>
                </div>

                <div className="panel-style">
                    <div className="label-style">Side</div>
                    <div className="row-style">
                        <button
                            onClick={() => {
                                setHumanColor("white")
                                if (mode === "ai") setOrientation("white");
                            }}
                        >
                            White
                        </button>
                        <button
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
                    <div className="hint">Drag board to rotate. Click a piece, then click a highlighted square. Promotion auto-chooses queen. The AI is a built-in minimax engine.</div>
                </div>
            </aside>
        </div>
    );
}

useGLTF.preload("/chess.glb");