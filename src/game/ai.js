import { Chess } from "chess.js";

const PIECE_VALUE = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000,
};

function evaluateBoard(game) {
    if (game.isCheckmate()) {
        return game.turn() === "w" ? -999999 : 999999;
    }

    if (game.isDraw()) return 0;

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

function minimax(game, depth, alpha, beta, maximisingPlayer) {
    if (depth === 0 || game.isGameOver()) {
        return { score: evaluateBoard(game), move: null };
    }

    const moves = game.moves();
    let bestMove = null;

    if (maximisingPlayer) {
        let bestScore = -Infinity;

        for (const move of moves) {
            game.move(move);
            const res = minimax(game, depth-1, alpha, beta, false);
            game.undo()
            
            if (res.score > bestScore) {
                bestScore = res.score;
                bestMove = move;
            }

            alpha = Math.max(alpha, bestScore);
            if (beta <= alpha) break;
        }
        return { score: bestScore, move: bestMove };
    } else {
        let bestScore = Infinity;

        for (const move of moves) {
            game.move(move);
            const res = minimax(game, depth-1, alpha, beta, true);
            game.undo();

            if (res.score < bestScore) {
                bestScore = res.score;
                bestMove = move;
            }
            beta = Math.min(beta, bestScore);
            if (beta <= alpha) break;
        }
        return { score: bestScore, move: bestMove };
    }
}

export function getBestMove(fen, depth = 2) {
    const game = new Chess(fen);
    const maximisingPlayer = game.turn() === "w";
    const res = minimax(game, depth, -Infinity, Infinity, maximisingPlayer);
    return res.move;
}