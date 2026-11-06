import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, freshCampaign, normalizeCampaign, recordResult, getChapter, describePiece,
} from '../dist/campaign.js';

test('starts with a short easy tutorial and independent fresh state', () => {
  const campaign = freshCampaign();
  const chapter = getChapter(campaign);
  assert.equal(chapter.round, 1);
  assert.equal(chapter.tutorial, true);
  assert.equal(chapter.level, 1);
  assert.equal(chapter.newRule, null);
  assert.deepEqual(chapter.ruleCards, []);
  assert.deepEqual(chapter.rules, { backwardPawns: false, longKing: false, knightCrown: false });
  assert.notEqual(freshCampaign().history, campaign.history);
  assert.equal(typeof STORAGE_KEY, 'string');
});

test('first mutation happens after exactly three played games, including losses and draws', () => {
  let campaign = freshCampaign();
  campaign = recordResult(campaign, 'loss');
  campaign = recordResult(campaign, 'draw');
  assert.equal(getChapter(campaign).newRule, null);
  campaign = recordResult(campaign, 'loss');
  assert.equal(campaign.wins, 0);
  const chapter = getChapter(campaign);
  assert.equal(chapter.round, 4);
  assert.equal(chapter.rules.backwardPawns, true);
  assert.equal(chapter.newRule.id, 'backwardPawns');
  assert.equal(chapter.newRule.threshold, 3);
  assert.equal(chapter.level, 1);
  assert.equal(chapter.tutorial, false);
  assert.ok(chapter.moodLevel > 40);
});

test('mutations accumulate and acknowledged rules stop prompting', () => {
  let campaign = freshCampaign();
  for (let i = 0; i < 3; i++) campaign = recordResult(campaign, 'win');
  campaign.rulesAcceptedFor = 3;
  assert.equal(getChapter(campaign).newRule, null);
  for (let i = 0; i < 2; i++) campaign = recordResult(campaign, 'win');
  assert.equal(getChapter(campaign).newRule.id, 'longKing');
  campaign.rulesAcceptedFor = 5;
  for (let i = 0; i < 2; i++) campaign = recordResult(campaign, 'win');
  const chapter = getChapter(campaign);
  assert.equal(chapter.newRule.id, 'knightCrown');
  assert.deepEqual(chapter.rules, { backwardPawns: true, longKing: true, knightCrown: true });
  assert.equal(chapter.ruleCards.length, 3);
  assert.deepEqual(chapter.ruleCards.map(rule => rule.introduced), [false, false, true]);
  campaign.rulesAcceptedFor = 7;
  assert.equal(getChapter(campaign).newRule, null);
});

test('ten wins are total: losses and draws do not reset progress', () => {
  let campaign = freshCampaign();
  for (let i = 0; i < 10; i++) {
    campaign = recordResult(campaign, 'win');
    if (i < 9) campaign = recordResult(campaign, i % 2 ? 'draw' : 'loss');
  }
  assert.equal(campaign.wins, 10);
  assert.equal(campaign.played, 19);
  assert.equal(getChapter(campaign).level, 10);
  assert.match(getChapter(campaign).title, /Десять побед/);
  assert.equal(getChapter(campaign).newRule, null);
  assert.match(getChapter(campaign).quote, /Ты выиграл/);
});

test('recording is immutable, history is bounded, and invalid results fail clearly', () => {
  const original = freshCampaign();
  const next = recordResult(original, 'win');
  assert.deepEqual(original, freshCampaign());
  assert.notEqual(next.history, original.history);
  let campaign = next;
  for (let i = 0; i < 25; i++) campaign = recordResult(campaign, 'loss');
  assert.equal(campaign.history.length, 20);
  assert.equal(campaign.history.at(-1).round, 26);
  assert.throws(() => recordResult(original, 'victory'), RangeError);
});

test('normalization safely handles corrupted storage without inheriting references', () => {
  for (const invalid of [null, undefined, 'x', [], 1]) assert.deepEqual(normalizeCampaign(invalid), freshCampaign());
  assert.deepEqual(normalizeCampaign({ wins: '10', played: NaN, rulesAcceptedFor: Infinity }), freshCampaign());
  const raw = { wins: 200, played: 7, rulesAcceptedFor: 100, history: [
    { round: 1, result: 'win', extra: 'ignored' },
    { round: 0, result: 'loss' },
    { round: 20, result: 'draw' },
    { round: 2, result: 'bad' },
    null,
  ] };
  const normalized = normalizeCampaign(raw);
  assert.equal(normalized.wins, 10);
  assert.equal(normalized.played, 10);
  assert.equal(normalized.rulesAcceptedFor, 7);
  assert.deepEqual(normalized.history, [{ round: 1, result: 'win' }]);
  assert.notEqual(normalized.history[0], raw.history[0]);
  assert.equal(normalizeCampaign({ played: 4, rulesAcceptedFor: 7 }).rulesAcceptedFor, 3);
});

test('piece descriptions reflect every active movement mutation', () => {
  assert.doesNotMatch(describePiece('P'), /отступить/);
  assert.match(describePiece('P', { backwardPawns: true }), /отступить/);
  assert.match(describePiece('K', { longKing: true }), /две клетки/);
  assert.match(describePiece('N', { knightCrown: true }), /один шаг/);
  assert.match(describePiece('Q'), /12 направлений/);
  assert.equal(typeof describePiece('unknown'), 'string');
});
