import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, getHint, applyMove, getLegalMoves, chooseAIMove, isInCheck,
} from '../dist/engine.js';
import {
  freshCampaign, normalizeCampaign, getChapter, recordResult,
} from '../dist/campaign.js';

test('complete campaign lifecycle crosses three played matches, cumulative rules, and ten total wins', () => {
  let campaign = freshCampaign();
  let chapter = getChapter(campaign);
  const tutorial = createGame({ tutorial: chapter.tutorial, rules: chapter.rules });
  const completed = applyMove(tutorial, getHint(tutorial));
  assert.deepEqual(completed.result, { winner: 'w', reason: 'checkmate' });
  campaign = recordResult(campaign, 'win');

  // The saved settled snapshot contains the already-counted result and round.
  const saved = JSON.parse(JSON.stringify({ campaign, game: completed, settled: true, round: campaign.played }));
  campaign = normalizeCampaign(saved.campaign);
  assert.equal(saved.round, campaign.played);
  assert.equal(campaign.wins, 1);
  assert.equal(saved.game.result.winner, 'w');

  campaign = recordResult(campaign, 'loss');
  assert.equal(getChapter(campaign).newRule, null);
  campaign = recordResult(campaign, 'loss');
  chapter = getChapter(campaign);
  assert.equal(campaign.played, 3);
  assert.equal(campaign.wins, 1);
  assert.equal(chapter.newRule.id, 'backwardPawns');

  for (const threshold of [3, 5, 7]) {
    while (campaign.played < threshold) campaign = recordResult(campaign, 'draw');
    chapter = getChapter(campaign);
    assert.equal(chapter.newRule.threshold, threshold);
    campaign = { ...campaign, rulesAcceptedFor: threshold };
    chapter = getChapter(campaign);
    assert.equal(chapter.newRule, null);
    assert.equal(chapter.tutorial, false);
    const nextRound = createGame({ tutorial: chapter.tutorial, rules: chapter.rules });
    assert.deepEqual(nextRound.rules, chapter.rules);
    assert.equal(isInCheck(nextRound, 'w'), false);
    assert.equal(isInCheck(nextRound, 'b'), false);
    const move = getLegalMoves(nextRound)[0];
    assert.ok(move);
    const after = applyMove(nextRound, move);
    assert.ok(after);
    assert.deepEqual(after.rules, chapter.rules);
  }
  assert.deepEqual(getChapter(campaign).rules, {
    backwardPawns: true, longKing: true, knightCrown: true,
  });
  while (campaign.wins < 9) campaign = recordResult(campaign, 'win');
  campaign = recordResult(campaign, 'loss');
  assert.equal(campaign.wins, 9);
  campaign = recordResult(campaign, 'win');
  assert.equal(campaign.wins, 10);
  assert.ok(campaign.played > 10);
  assert.equal(getChapter(campaign).newRule, null);
  assert.match(getChapter(campaign).quote, /Ты выиграл/);
});

test('saved mid-round engine state resumes legally with cumulative campaign rules', () => {
  const campaign = normalizeCampaign({ wins: 4, played: 7, rulesAcceptedFor: 7, history: [] });
  const chapter = getChapter(campaign);
  let game = createGame({ rules: chapter.rules });
  game = applyMove(game, getLegalMoves(game)[0]);
  assert.equal(game.turn, 'b');
  const restored = JSON.parse(JSON.stringify({ campaign, game, settled: false, round: chapter.round }));
  assert.equal(restored.round, restored.campaign.played + 1);
  const reply = chooseAIMove(restored.game, { level: chapter.level, seed: 123 });
  assert.ok(reply);
  const resumed = applyMove(restored.game, reply);
  assert.ok(resumed);
  assert.equal(resumed.turn, 'w');
  assert.equal(isInCheck(resumed, 'b'), false);
  assert.deepEqual(resumed.rules, chapter.rules);
  assert.equal(normalizeCampaign(restored.campaign).wins, 4);
});
