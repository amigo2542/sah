import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createGame, getHint, getLegalMoves, applyMove } from '../dist/engine.js';
import { STORAGE_KEY, freshCampaign } from '../dist/campaign.js';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
let importSerial = 0;

/** DOM integration only: no browser, HTTP server, layout, or screenshot claims. */
function harness(initial = null) {
  const globals = ['document', 'window', 'localStorage', 'Worker', 'setTimeout', 'clearTimeout'];
  const originals = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const storage = new Map(initial === null ? [] : [[STORAGE_KEY, typeof initial === 'string' ? initial : JSON.stringify(initial)]]);
  const timers = new Map();
  let timerId = 0;
  let window;
  let document;
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const api = {
    async load() {
      timers.clear();
      ({ window, document } = parseHTML(html));
      const modal = document.getElementById('modal');
      modal.open = false;
      modal.showModal = () => { modal.open = true; modal.setAttribute('open', ''); };
      modal.close = () => {
        const wasOpen = modal.open;
        modal.open = false; modal.removeAttribute('open');
        if (wasOpen) modal.dispatchEvent(new window.Event('close'));
      };
      define('document', document);
      define('window', window);
      define('localStorage', {
        getItem: name => storage.get(name) ?? null,
        setItem: (name, value) => storage.set(name, String(value)),
        removeItem: name => storage.delete(name),
      });
      define('Worker', class { constructor() { throw new Error('Worker unavailable in DOM test'); } });
      define('setTimeout', callback => { const id = ++timerId; timers.set(id, callback); return id; });
      define('clearTimeout', id => timers.delete(id));
      await import(`../dist/app.js?ui-test=${++importSerial}`);
      return api;
    },
    get: id => document.getElementById(id),
    query: selector => document.querySelector(selector),
    count: selector => document.querySelectorAll(selector).length,
    click(id) {
      const element = document.getElementById(id);
      assert.ok(element, `Expected #${id}`);
      assert.notEqual(element.disabled, true, `#${id} is disabled`);
      element.dispatchEvent(new window.Event('click', { bubbles: true }));
    },
    clickCell(cell) {
      const element = document.querySelector(`[data-cell="${cell}"]`);
      assert.ok(element, `Expected board cell ${cell}`);
      element.dispatchEvent(new window.Event('click', { bubbles: true }));
    },
    saved: () => JSON.parse(storage.get(STORAGE_KEY) || 'null'),
    timerCount: () => timers.size,
    tick() {
      const first = timers.entries().next().value;
      assert.ok(first, 'Expected an AI timer');
      timers.delete(first[0]); first[1]();
    },
    cancelModal() {
      const event = new window.Event('cancel', { cancelable: true });
      api.get('modal').dispatchEvent(event);
      return event;
    },
    dispose() {
      timers.clear();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
  return api;
}

test('UI: tutorial victory, review-board continuation, reload, third played result and rule acceptance', async () => {
  const ui = harness();
  try {
    await ui.load();
    assert.equal(ui.count('[data-cell]'), 61);
    assert.equal(ui.count('#board .piece'), 3);
    assert.equal(ui.get('wins-number').textContent, '00');
    assert.equal(ui.get('modal').open, false);
    const matingMove = getHint(ui.saved().game);
    ui.click('hint-button');
    assert.equal(ui.count('#board .hinted'), 2);
    ui.clickCell(matingMove.to);
    assert.equal(ui.get('modal').open, true);
    assert.equal(ui.get('wins-number').textContent, '01');
    assert.equal(ui.saved().campaign.played, 1);
    assert.equal(ui.saved().settled, true);
    assert.equal(ui.saved().game.result.winner, 'w');

    ui.click('review-board');
    assert.equal(ui.get('modal').open, false);
    assert.match(ui.get('hint-button').textContent, /Ещё одну/);
    ui.click('hint-button');
    assert.equal(ui.count('#board .piece'), 26);
    assert.equal(ui.saved().settled, false);
    assert.equal(ui.get('round-label').textContent, 'ПАРТИЯ 02');
    ui.click('resign-button');
    ui.click('confirm-resign');
    assert.equal(ui.saved().campaign.played, 2);
    assert.equal(ui.saved().campaign.wins, 1);

    await ui.load();
    assert.equal(ui.get('modal').open, true);
    assert.equal(ui.saved().campaign.played, 2, 'Reload must not count settled result twice');
    assert.equal(ui.saved().campaign.wins, 1);
    ui.click('next-round');
    ui.click('resign-button');
    ui.click('confirm-resign');
    assert.equal(ui.saved().campaign.played, 3);
    assert.equal(ui.saved().campaign.wins, 1);
    assert.equal(ui.get('rule-count').textContent, '01', 'Completed board retains the rules it used');
    ui.click('next-round');
    assert.equal(ui.get('modal').open, true);
    assert.equal(ui.get('modal').dataset.locked, 'true');
    assert.ok(ui.get('accept-rule'));
    assert.equal(ui.cancelModal().defaultPrevented, true);
    assert.equal(ui.saved().game.rules.backwardPawns, true);
    ui.click('accept-rule');
    assert.equal(ui.get('modal').open, false);
    assert.equal(ui.saved().campaign.rulesAcceptedFor, 3);
    assert.equal(ui.get('round-label').textContent, 'ПАРТИЯ 04');
    assert.equal(ui.get('rule-count').textContent, '02');
    await ui.load();
    assert.equal(ui.get('modal').open, false, 'Accepted rule should not appear again on reload');
    assert.equal(ui.saved().campaign.wins, 1);
  } finally { ui.dispose(); }
});

test('UI: tenth total victory ends the story and final-board controls remain usable', async () => {
  const campaign = { ...freshCampaign(), wins: 9, played: 12, rulesAcceptedFor: 7 };
  const rules = { backwardPawns: true, longKing: true, knightCrown: true };
  const game = createGame({ tutorial: true, rules });
  const ui = harness({ campaign, game, settled: false, sound: false, round: 13 });
  try {
    await ui.load();
    const move = getHint(ui.saved().game);
    ui.click('hint-button');
    ui.clickCell(move.to);
    assert.equal(ui.saved().campaign.wins, 10);
    assert.equal(ui.saved().campaign.played, 13);
    assert.match(ui.get('modal-title').textContent, /Десять/);
    assert.equal(ui.count('.win-marker.complete'), 10);
    ui.click('next-round');
    assert.equal(ui.get('modal').open, false);
    assert.equal(ui.saved().settled, true, 'Final board must not start an eleventh campaign match');
    assert.match(ui.get('hint-button').textContent, /Итог/);
    ui.click('hint-button');
    assert.equal(ui.get('modal').open, true);
    ui.click('next-round');
    ui.click('reset-button');
    ui.click('confirm-reset');
    assert.equal(ui.saved().campaign.wins, 0);
    assert.equal(ui.saved().campaign.played, 0);
    assert.equal(ui.count('#board .piece'), 3);
  } finally { ui.dispose(); }
});

test('UI: a saved black-to-move position resumes through AI fallback', async () => {
  const campaign = { ...freshCampaign(), wins: 1, played: 1 };
  let game = createGame();
  game = applyMove(game, getLegalMoves(game)[0]);
  const ui = harness({ campaign, game, settled: false, sound: false, round: 2 });
  try {
    await ui.load();
    assert.equal(ui.timerCount(), 1);
    assert.match(ui.get('turn-label').textContent, /ДУМАЕТ/);
    ui.tick();
    assert.equal(ui.saved().game.turn, 'w');
    assert.equal(ui.saved().campaign.wins, 1);
    assert.equal(ui.saved().game.ply, 2);
    assert.match(ui.get('turn-label').textContent, /ВАШ ХОД|ШАХ/);
  } finally { ui.dispose(); }
});

test('UI: corrupted JSON storage recovers to a playable first match', async () => {
  const ui = harness('{broken JSON');
  try {
    await ui.load();
    assert.equal(ui.count('[data-cell]'), 61);
    assert.equal(ui.saved().campaign.wins, 0);
    assert.equal(ui.saved().game.turn, 'w');
    assert.equal(ui.get('hint-button').disabled, false);
  } finally { ui.dispose(); }
});

test('UI: interrupted terminal snapshot with missing rules settles once and survives another reload', async () => {
  let game = createGame({ tutorial: true });
  game = applyMove(game, getHint(game));
  delete game.rules;
  game.halfmove = 'corrupted';
  const ui = harness({ campaign: freshCampaign(), game, settled: false, sound: false, round: 1 });
  try {
    await ui.load();
    assert.equal(ui.saved().settled, true);
    assert.equal(ui.saved().campaign.wins, 1);
    assert.equal(ui.saved().campaign.played, 1);
    assert.deepEqual(ui.saved().game.rules, { backwardPawns: false, longKing: false, knightCrown: false });
    assert.equal(ui.saved().game.halfmove, 0);
    assert.equal(ui.get('modal').open, true);
    await ui.load();
    assert.equal(ui.saved().campaign.wins, 1);
    assert.equal(ui.saved().campaign.played, 1);
    ui.click('review-board');
    ui.click('hint-button');
    assert.equal(ui.get('round-label').textContent, 'ПАРТИЯ 02');
    assert.equal(ui.count('#board .piece'), 26);
  } finally { ui.dispose(); }
});

test('UI: settled third consecutive win retains its old rules until the fourth round', async () => {
  let game = createGame({ tutorial: true });
  game = applyMove(game, getHint(game));
  const campaign = { ...freshCampaign(), wins: 3, played: 3 };
  const ui = harness({ campaign, game, settled: true, sound: false, round: 3 });
  try {
    await ui.load();
    assert.equal(ui.get('rule-count').textContent, '01');
    ui.click('review-board');
    ui.click('rules-button');
    assert.doesNotMatch(ui.get('modal-content').textContent, /Теперь также может отступить/);
    ui.click('understood-rules');
    ui.click('hint-button');
    assert.equal(ui.saved().game.rules.backwardPawns, true);
    assert.equal(ui.get('rule-count').textContent, '02');
    assert.ok(ui.get('accept-rule'));
  } finally { ui.dispose(); }
});
