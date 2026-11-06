import test from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, key, parseKey, createGame, getLegalMoves, applyMove, isInCheck, chooseAIMove, getHint } from '../dist/engine.js';

const position = (entries, { turn = 'w', rules = {} } = {}) => ({ ...createGame({ rules }),
  pieces: Object.fromEntries(entries.map(([q, r, type, color], i) => [key(q, r), { type, color, id: String(i) }])), turn });

test('61-cell axial board and balanced legal starting position', () => {
  assert.equal(CELLS.length, 61);
  assert.equal(new Set(CELLS.map(c => key(c.q, c.r))).size, 61);
  assert.deepEqual(parseKey('-2,3'), { q: -2, r: 3 });
  const game = createGame();
  for (const color of ['w', 'b']) {
    assert.equal(Object.values(game.pieces).filter(p => p.color === color).length, 13);
    assert.equal(isInCheck(game, color), false);
  }
  assert.ok(getLegalMoves(game).length > 15);
});

test('tutorial has a legal mate in one and hint finds it', () => {
  const game = createGame({ tutorial: true });
  assert.equal(isInCheck(game, 'w'), false);
  assert.equal(isInCheck(game, 'b'), false);
  const hint = getHint(game);
  const next = applyMove(game, hint);
  assert.deepEqual(next.result, { winner: 'w', reason: 'checkmate' });
  assert.equal(getLegalMoves(next).length, 0);
  assert.equal(game.result, null);
  assert.ok(game.pieces[hint.from]);
});

test('friendly captures and off-board/invalid moves are rejected immutably', () => {
  const game = createGame();
  const before = JSON.stringify(game);
  assert.equal(applyMove(game, { from: '-1,4', to: '-2,4' }), null);
  assert.equal(applyMove(game, { from: '-1,4', to: '9,9' }), null);
  assert.equal(applyMove(game, { from: '9,9', to: '0,0' }), null);
  assert.equal(applyMove(game, { to: getLegalMoves(game)[0].to }), null);
  const next = applyMove(game, getLegalMoves(game)[0]);
  assert.ok(next);
  assert.notEqual(next.pieces, game.pieces);
  assert.equal(JSON.stringify(game), before);
  assert.equal(next.turn, 'b');
});

test('king cannot be captured and a pinned piece cannot expose its king', () => {
  const game = position([[0, 3, 'K', 'w'], [0, 2, 'R', 'w'], [0, -2, 'R', 'b'], [3, -3, 'K', 'b']]);
  assert.equal(isInCheck(game, 'w'), false);
  assert.equal(getLegalMoves(game, '0,2').some(m => m.to === '1,2'), false);
  assert.equal(getLegalMoves(game).some(m => m.to === '3,-3'), false);
  const checked = { ...game, pieces: { ...game.pieces } };
  delete checked.pieces['0,2'];
  assert.equal(isInCheck(checked, 'w'), true);
  for (const move of getLegalMoves(checked)) assert.equal(isInCheck(applyMove(checked, move), 'w'), false);
});

test('pawns promote at their forward board edge', () => {
  const game = position([[0, 3, 'K', 'w'], [4, -1, 'K', 'b'], [0, -3, 'P', 'w']]);
  const move = getLegalMoves(game, '0,-3').find(m => m.to === '0,-4');
  assert.equal(move.promotion, 'Q');
  const next = applyMove(game, move);
  assert.equal(next.pieces['0,-4'].type, 'Q');
  assert.equal(next.halfmove, 0);
});

test('backward pawn rule adds retreat and reverse captures', () => {
  const entries = [[-3, 3, 'K', 'w'], [3, -3, 'K', 'b'], [0, 0, 'P', 'w'], [1, 0, 'N', 'b']];
  const normal = position(entries);
  const changed = position(entries, { rules: { backwardPawns: true } });
  assert.equal(getLegalMoves(normal, '0,0').some(m => m.to === '0,1' || m.to === '1,0'), false);
  assert.equal(getLegalMoves(changed, '0,0').some(m => m.to === '0,1'), true);
  assert.equal(getLegalMoves(changed, '0,0').some(m => m.to === '1,0'), true);
});

test('long king and knight crown obey occupancy and self-check', () => {
  const entries = [[0, 2, 'K', 'w'], [3, -3, 'K', 'b'], [-2, 1, 'N', 'w']];
  const normal = position(entries);
  const changed = position(entries, { rules: { longKing: true, knightCrown: true } });
  assert.equal(getLegalMoves(normal, '0,2').some(m => m.to === '2,2'), false);
  assert.equal(getLegalMoves(changed, '0,2').some(m => m.to === '2,2'), true);
  assert.equal(getLegalMoves(normal, '-2,1').some(m => m.to === '-1,1'), false);
  assert.equal(getLegalMoves(changed, '-2,1').some(m => m.to === '-1,1'), true);
  changed.pieces['1,2'] = { type: 'P', color: 'w', id: 'blocker' };
  assert.equal(getLegalMoves(changed, '0,2').some(m => m.to === '2,2'), false);
});

test('long king cannot cross an attacked intermediate cell', () => {
  const game = position([[0, 2, 'K', 'w'], [3, -3, 'K', 'b'], [1, -2, 'R', 'b']], { rules: { longKing: true } });
  assert.equal(isInCheck(game, 'w'), false);
  assert.equal(getLegalMoves(game, '0,2').some(m => m.to === '2,2'), false);
});

test('tutorial remains mate-in-one with every supported mutation enabled', () => {
  const game = createGame({ tutorial: true, rules: { backwardPawns: true, longKing: true, knightCrown: true } });
  assert.equal(isInCheck(game, 'w'), false);
  assert.equal(isInCheck(game, 'b'), false);
  assert.deepEqual(applyMove(game, getHint(game)).result, { winner: 'w', reason: 'checkmate' });
});

test('bare kings and fifty-move threshold produce draws', () => {
  const bare = position([[-3, 3, 'K', 'w'], [3, -3, 'K', 'b']]);
  assert.equal(applyMove(bare, getLegalMoves(bare)[0]).result.reason, 'insufficient-material');
  const game = createGame();
  game.halfmove = 99;
  const move = getLegalMoves(game).find(m => game.pieces[m.from].type !== 'P' && !game.pieces[m.to]);
  assert.equal(applyMove(game, move).result.reason, 'fifty-move');
});

test('third identical position draws, ignoring piece ids and preserving serializable counts', () => {
  let game = position([[-3, 3, 'K', 'w'], [3, -3, 'K', 'b'], [-2, 1, 'N', 'w'], [2, -1, 'N', 'b']]);
  // A restored game from an older version has no count table yet.
  delete game.positionCounts;
  const cycle = [
    { from: '-2,1', to: '-1,3' }, { from: '2,-1', to: '1,-3' },
    { from: '-1,3', to: '-2,1' }, { from: '1,-3', to: '2,-1' },
  ];
  for (const move of cycle) game = applyMove(game, move);
  assert.equal(game.result, null);
  assert.equal(Math.max(...Object.values(game.positionCounts)), 2);
  game = JSON.parse(JSON.stringify(game));
  for (const piece of Object.values(game.pieces)) piece.id += '-new-id';
  const previous = game;
  for (const move of cycle) game = applyMove(game, move);
  assert.deepEqual(game.result, { winner: null, reason: 'repetition' });
  assert.equal(Math.max(...Object.values(game.positionCounts)), 3);
  assert.equal(Math.max(...Object.values(previous.positionCounts)), 2);
});

test('repetition signature includes active rules and side to move', () => {
  let game = position([[-3, 3, 'K', 'w'], [3, -3, 'K', 'b'], [-2, 1, 'N', 'w'], [2, -1, 'N', 'b']]);
  const cycle = [
    { from: '-2,1', to: '-1,3' }, { from: '2,-1', to: '1,-3' },
    { from: '-1,3', to: '-2,1' }, { from: '1,-3', to: '2,-1' },
  ];
  for (const move of cycle) game = applyMove(game, move);
  game.rules = { ...game.rules, backwardPawns: true };
  for (const move of cycle) game = applyMove(game, move);
  assert.equal(game.result, null);
  assert.equal(Math.max(...Object.values(game.positionCounts)), 2);
  for (const move of cycle) game = applyMove(game, move);
  assert.deepEqual(game.result, { winner: null, reason: 'repetition' });
});

test('a mating move takes priority over repetition bookkeeping', () => {
  let game = createGame({ tutorial: true });
  const move = getHint(game);
  const mate = applyMove(game, move);
  const resultingSignature = Object.keys(mate.positionCounts).find(signature => !(signature in game.positionCounts));
  game.positionCounts[resultingSignature] = 2;
  assert.deepEqual(applyMove(game, move).result, { winner: 'w', reason: 'checkmate' });
});

test('stalemate is distinguished from checkmate', () => {
  // Find the quiet move into a corner net, then verify the resulting draw.
  const game = position([[2, -1, 'K', 'w'], [1, 1, 'Q', 'w'], [4, 0, 'K', 'b']]);
  const stalemates = getLegalMoves(game).map(m => applyMove(game, m)).filter(next => next.result?.reason === 'stalemate');
  assert.ok(stalemates.length > 0);
  assert.equal(stalemates[0].result.winner, null);
  assert.equal(isInCheck(stalemates[0], 'b'), false);
});

test('AI returns legal seeded moves and high-level search remains bounded', () => {
  const game = createGame();
  assert.deepEqual(chooseAIMove(game, { level: 1, seed: 42 }), chooseAIMove(game, { level: 1, seed: 42 }));
  const started = performance.now();
  const move = chooseAIMove(game, { level: 10, seed: 42 });
  const elapsed = performance.now() - started;
  assert.ok(getLegalMoves(game).some(m => m.from === move.from && m.to === move.to));
  assert.ok(elapsed < 700, `AI took ${elapsed.toFixed(0)}ms`);
});
