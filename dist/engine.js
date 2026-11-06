/**
 * Small, deliberately custom hex-chess variant (not Glinski chess).
 * Axial coordinates, radius 4. Rooks use six edge rays, bishops six vertex
 * rays; kings take one edge or vertex step and knights make twelve (2+1)
 * jumps. Pawns take one forward step; there is no double step, castling or
 * en-passant. A pawn promotes to queen at its forward edge of the board.
 */

const RADIUS = 4;
const EDGE = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const VERTEX = [[1, 1], [-1, 2], [-2, 1], [-1, -1], [1, -2], [2, -1]];
const KING = [...EDGE, ...VERTEX];
const KNIGHT = EDGE.flatMap(([q, r], i) => {
  const a = EDGE[(i + 1) % 6];
  const b = EDGE[(i + 5) % 6];
  return [[q * 2 + a[0], r * 2 + a[1]], [q * 2 + b[0], r * 2 + b[1]]];
});
const VALUE = { K: 0, Q: 950, R: 550, B: 370, N: 350, P: 100 };

export const key = (q, r) => `${q},${r}`;
export const parseKey = value => {
  const [q, r] = String(value).split(',').map(Number);
  return { q, r };
};
export const CELLS = Object.freeze(Array.from({ length: 9 }, (_, i) => i - 4)
  .flatMap(r => Array.from({ length: 9 }, (_, i) => i - 4)
    .filter(q => Math.abs(q + r) <= RADIUS).map(q => Object.freeze({ q, r }))));
const BOARD = new Set(CELLS.map(({ q, r }) => key(q, r)));
const inside = (q, r) => BOARD.has(key(q, r));
const opposite = color => color === 'w' ? 'b' : 'w';
export const pieceName = type => ({ K: 'король', Q: 'ферзь', R: 'ладья', B: 'слон', N: 'конь', P: 'пешка' })[typeof type === 'object' ? type.type : type] || String(type);

function positionSignature(game) {
  const rules = game.rules || {};
  const ruleBits = ['backwardPawns', 'longKing', 'knightCrown'].map(name => rules[name] ? '1' : '0').join('');
  const placement = Object.entries(game.pieces).sort(([a], [b]) => a.localeCompare(b))
    .map(([square, piece]) => `${square}:${piece.color}${piece.type}`).join(';');
  return `${game.turn}|${ruleBits}|${placement}`;
}

export function createGame({ tutorial = false, rules = {} } = {}) {
  const pieces = {};
  let serial = 0;
  const add = (q, r, type, color) => { pieces[key(q, r)] = { type, color, id: `${color}${type}${serial++}` }; };
  if (tutorial) {
    // Q(1,1) -> (3,0) is a legal mate in one, even with the supported mutators.
    add(2, -1, 'K', 'w');
    add(1, 1, 'Q', 'w');
    add(4, 0, 'K', 'b');
  } else {
    const back = [[-4, 4, 'R'], [-3, 4, 'N'], [-2, 4, 'Q'], [-1, 4, 'K'], [0, 4, 'R'],
      [-3, 3, 'B'], [-1, 3, 'N'], [1, 3, 'B']];
    for (const [q, r, type] of back) {
      add(q, r, type, 'w');
      add(-q, -r, type, 'b');
    }
    for (let q = -3; q <= 1; q++) {
      add(q, 2, 'P', 'w');
      add(-q, -2, 'P', 'b');
    }
  }
  const game = { pieces, turn: 'w', ply: 0, halfmove: 0, result: null, lastMove: null,
    rules: { backwardPawns: false, longKing: false, knightCrown: false, ...rules } };
  game.positionCounts = { [positionSignature(game)]: 1 };
  return game;
}

function pawnCaptures(color, rules) {
  const forward = color === 'w' ? [[-1, 0], [1, -1]] : [[1, 0], [-1, 1]];
  return rules.backwardPawns ? [...forward, ...forward.map(([q, r]) => [-q, -r])] : forward;
}

function attacks(game, from, target, piece) {
  const start = parseKey(from);
  const end = parseKey(target);
  const dq = end.q - start.q;
  const dr = end.r - start.r;
  const matches = offsets => offsets.some(([q, r]) => q === dq && r === dr);
  if (piece.type === 'P') return matches(pawnCaptures(piece.color, game.rules));
  if (piece.type === 'N') return matches(game.rules.knightCrown ? [...KNIGHT, ...EDGE] : KNIGHT);
  if (piece.type === 'K') {
    if (matches(KING)) return true;
    return !!game.rules.longKing && EDGE.some(([q, r]) => q * 2 === dq && r * 2 === dr && !game.pieces[key(start.q + q, start.r + r)]);
  }
  const dirs = piece.type === 'R' ? EDGE : piece.type === 'B' ? VERTEX : KING;
  for (const [sq, sr] of dirs) {
    for (let q = start.q + sq, r = start.r + sr; inside(q, r); q += sq, r += sr) {
      if (q === end.q && r === end.r) return true;
      if (game.pieces[key(q, r)]) break;
    }
  }
  return false;
}

export function isInCheck(game, color) {
  const king = Object.entries(game.pieces).find(([, p]) => p.type === 'K' && p.color === color);
  if (!king) return true;
  return Object.entries(game.pieces).some(([from, p]) => p.color !== color && attacks(game, from, king[0], p));
}

function pseudoMoves(game, from) {
  const piece = game.pieces[from];
  if (!piece) return [];
  const { q, r } = parseKey(from);
  const moves = [];
  const add = (tq, tr, captureOnly = false) => {
    if (!inside(tq, tr)) return false;
    const to = key(tq, tr);
    const occupied = game.pieces[to];
    if (occupied?.color === piece.color || occupied?.type === 'K') return false;
    if (!captureOnly || occupied) {
      const move = { from, to };
      if (piece.type === 'P' && !inside(tq, tr + (piece.color === 'w' ? -1 : 1))) move.promotion = 'Q';
      moves.push(move);
    }
    return !occupied;
  };
  if (piece.type === 'P') {
    const direction = piece.color === 'w' ? -1 : 1;
    if (!game.pieces[key(q, r + direction)]) add(q, r + direction);
    if (game.rules.backwardPawns && !game.pieces[key(q, r - direction)]) add(q, r - direction);
    for (const [dq, dr] of pawnCaptures(piece.color, game.rules)) add(q + dq, r + dr, true);
  } else if (piece.type === 'N') {
    for (const [dq, dr] of game.rules.knightCrown ? [...KNIGHT, ...EDGE] : KNIGHT) add(q + dq, r + dr);
  } else if (piece.type === 'K') {
    for (const [dq, dr] of KING) add(q + dq, r + dr);
    if (game.rules.longKing) for (const [dq, dr] of EDGE) {
      if (inside(q + dq, r + dr) && !game.pieces[key(q + dq, r + dr)]) add(q + dq * 2, r + dr * 2);
    }
  } else {
    const dirs = piece.type === 'R' ? EDGE : piece.type === 'B' ? VERTEX : KING;
    for (const [dq, dr] of dirs) {
      for (let tq = q + dq, tr = r + dr; inside(tq, tr); tq += dq, tr += dr) {
        if (!add(tq, tr)) break;
      }
    }
  }
  return moves;
}

function moveUnchecked(game, move) {
  const piece = game.pieces[move.from];
  const captured = game.pieces[move.to];
  const pieces = { ...game.pieces };
  delete pieces[move.from];
  pieces[move.to] = move.promotion ? { ...piece, type: 'Q' } : { ...piece };
  return { ...game, pieces, turn: opposite(game.turn), ply: (game.ply || 0) + 1,
    halfmove: piece.type === 'P' || captured ? 0 : (game.halfmove || 0) + 1,
    lastMove: { ...move, piece: { ...piece }, captured: captured ? { ...captured } : null }, result: null };
}

export function getLegalMoves(game, from) {
  if (game.result) return [];
  const starts = from ? [from] : Object.keys(game.pieces);
  const legal = [];
  for (const start of starts) {
    if (game.pieces[start]?.color !== game.turn) continue;
    for (const move of pseudoMoves(game, start)) {
      // The extended king must also cross a safe intermediate cell.
      if (game.pieces[start].type === 'K' && game.rules.longKing) {
        const a = parseKey(start);
        const b = parseKey(move.to);
        const extended = EDGE.find(([q, r]) => q * 2 === b.q - a.q && r * 2 === b.r - a.r);
        if (extended && isInCheck(moveUnchecked(game, { from: start, to: key(a.q + extended[0], a.r + extended[1]) }), game.turn)) continue;
      }
      if (!isInCheck(moveUnchecked(game, move), game.turn)) legal.push(move);
    }
  }
  return legal;
}

/** Returns a fresh game state, or null when the requested move is illegal. */
export function applyMove(game, requested) {
  if (!requested || game.result || typeof requested.from !== 'string' || typeof requested.to !== 'string') return null;
  const move = getLegalMoves(game, requested.from).find(m => m.to === requested.to && (!requested.promotion || requested.promotion === m.promotion));
  if (!move) return null;
  const next = moveUnchecked(game, move);
  // Only committed moves copy the count table. Search nodes share the original
  // reference and never build/copy repetition history during their simulations.
  const currentSignature = positionSignature(game);
  const history = game.positionCounts && Number.isSafeInteger(game.positionCounts[currentSignature])
    ? game.positionCounts : { [currentSignature]: 1 };
  const signature = positionSignature(next);
  const previousCount = Number.isSafeInteger(history[signature]) ? history[signature] : 0;
  next.positionCounts = { ...history, [signature]: previousCount + 1 };
  if (!getLegalMoves(next).length) next.result = isInCheck(next, next.turn)
    ? { winner: game.turn, reason: 'checkmate' }
    : { winner: null, reason: 'stalemate' };
  else if (next.positionCounts[signature] >= 3) next.result = { winner: null, reason: 'repetition' };
  else if (next.halfmove >= 100) next.result = { winner: null, reason: 'fifty-move' };
  else if (Object.values(next.pieces).every(p => p.type === 'K')) next.result = { winner: null, reason: 'insufficient-material' };
  return next;
}

function evaluate(game, color) {
  let score = 0;
  for (const [square, piece] of Object.entries(game.pieces)) {
    const { q, r } = parseKey(square);
    const central = 4 - Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    let value = VALUE[piece.type] + (piece.type === 'K' ? -central * 3 : central * 5);
    if (piece.type === 'P') value += (piece.color === 'w' ? 4 - r : 4 + r) * 7;
    score += piece.color === color ? value : -value;
  }
  return score;
}

function orderMoves(game, moves) {
  const rank = m => (game.pieces[m.to] ? VALUE[game.pieces[m.to].type] * 10 - VALUE[game.pieces[m.from].type] : 0)
    + (m.promotion ? 8000 : 0);
  return moves.map((move, i) => ({ move, rank: rank(move), i }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i).map(entry => entry.move);
}

/** A bounded, deterministic (when seeded) opponent; higher levels search deeper. */
export function chooseAIMove(game, { level = 1, seed } = {}) {
  const legal = getLegalMoves(game);
  if (!legal.length) return null;
  const difficulty = Math.max(1, Math.min(10, Number(level) || 1));
  let randomState = (Number(seed) || 0x6d2b79f5) >>> 0;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 4294967296;
  };
  if (difficulty === 1) return legal[Math.floor(random() * legal.length)];
  const color = game.turn;
  const deadline = Date.now() + (difficulty >= 7 ? 180 : 80);
  const depth = difficulty >= 7 ? 3 : difficulty >= 4 ? 2 : 1;
  const width = difficulty >= 7 ? 9 : 7;
  let visited = 0;
  const search = (state, remaining, alpha, beta) => {
    if (Date.now() >= deadline || visited++ > 2200) return evaluate(state, color);
    const options = getLegalMoves(state);
    if (!options.length) return isInCheck(state, state.turn) ? (state.turn === color ? -100000 - remaining : 100000 + remaining) : 0;
    if (remaining <= 0) return evaluate(state, color);
    const maximize = state.turn === color;
    let best = maximize ? -Infinity : Infinity;
    for (const move of orderMoves(state, options).slice(0, width)) {
      const score = search(moveUnchecked(state, move), remaining - 1, alpha, beta);
      best = maximize ? Math.max(best, score) : Math.min(best, score);
      if (maximize) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
      if (beta <= alpha || Date.now() >= deadline) break;
    }
    return best;
  };
  let bestMove = legal[0];
  let bestScore = -Infinity;
  // Always examine every root move for immediate mate before spending the search budget.
  const candidates = legal.map(move => {
    const next = moveUnchecked(game, move);
    const checking = isInCheck(next, next.turn);
    const finished = (checking || Object.keys(next.pieces).length <= 4) && !getLegalMoves(next).length;
    if (finished && checking) return { move, next, score: 100000 };
    return { move, next, score: finished ? 0 : evaluate(next, color) };
  });
  const immediateMate = candidates.find(c => c.score === 100000);
  if (immediateMate) return immediateMate.move;
  candidates.sort((a, b) => b.score - a.score);
  for (const { move, next, score: staticScore } of candidates.slice(0, Math.max(10, difficulty * 2))) {
    if (depth > 1 && bestScore > -Infinity && Date.now() >= deadline) break;
    const score = depth > 1 && Date.now() < deadline ? search(next, depth - 1, -Infinity, Infinity) : staticScore;
    const noisy = score + (random() - 0.5) * (difficulty <= 3 ? (4 - difficulty) * 100 : difficulty <= 5 ? 30 : 0);
    if (noisy > bestScore) { bestScore = noisy; bestMove = move; }
  }
  return bestMove;
}

/** Returns a strong move for the current position (normally the human's white turn). */
export function getHint(game) {
  return chooseAIMove(game, { level: 10, seed: 4297 });
}
