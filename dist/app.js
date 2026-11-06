import { CELLS, key, parseKey, createGame, getLegalMoves, applyMove, isInCheck, chooseAIMove, getHint, pieceName } from './engine.js';
import { STORAGE_KEY, freshCampaign, normalizeCampaign, getChapter, recordResult, describePiece } from './campaign.js';

const $ = (id) => document.getElementById(id);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pad = (value) => String(value).padStart(2, '0');
const coords = (cell) => {
  const parsed = parseKey(cell);
  const q = Array.isArray(parsed) ? parsed[0] : parsed.q;
  const r = Array.isArray(parsed) ? parsed[1] : parsed.r;
  return `${String.fromCharCode(69 + q)}${5 - r}`;
};
const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const cellKeys = new Set(CELLS.map(({ q, r }) => key(q, r)));
let campaign = freshCampaign();
let game;
let selected = null;
let suggested = null;
let thinking = false;
let settled = false;
let sound = false;
let storageAvailable = true;
let quote = '';
let worker = null;
let aiRequest = 0;
let aiTimer;
let audio;
let focusCell = '0,0';

// The complete match and campaign share one snapshot: a reload never awards a win twice.
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved) {
    campaign = normalizeCampaign(saved.campaign || saved);
    sound = saved.sound === true;
    const candidate = saved.game;
    const kings = candidate?.pieces && Object.values(candidate.pieces).filter((p) => p.type === 'K');
    if (candidate && candidate.pieces && ['w', 'b'].includes(candidate.turn) &&
        Object.entries(candidate.pieces).every(([cell, p]) => cellKeys.has(cell) && p && typeof p.type === 'string' && p.type.length === 1 && 'KQRBNP'.includes(p.type) && ['w', 'b'].includes(p.color)) &&
        kings?.some((p) => p.color === 'w') && kings?.some((p) => p.color === 'b') &&
        Number.isInteger(candidate.ply) && candidate.ply >= 0 &&
        saved.round === campaign.played + (saved.settled ? 0 : 1) &&
        (saved.settled !== true || candidate.result)) {
      const activeCampaign = saved.settled ? { ...campaign, played: Math.max(0, campaign.played - 1), wins: Math.max(0, campaign.wins - (candidate.result?.winner === 'w' ? 1 : 0)) } : campaign;
      game = { ...candidate, rules: getChapter(activeCampaign).rules, halfmove: Number.isInteger(candidate.halfmove) && candidate.halfmove >= 0 ? candidate.halfmove : 0 };
      settled = saved.settled === true;
      quote = typeof saved.quote === 'string' ? saved.quote : '';
    }
  }
} catch { storageAvailable = false; }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ campaign, game, settled, sound, quote, round: campaign.played + (settled ? 0 : 1) }));
    storageAvailable = true;
  } catch { storageAvailable = false; }
}

function pieceSVG(type, color = 'w', nested = false) {
  const fill = color === 'w' ? '#f6f3de' : '#253025';
  const stroke = color === 'w' ? '#526044' : '#0e160f';
  const accent = color === 'w' ? '#bdc4a5' : '#6e8057';
  const base = '<path d="M10 34h24l2 5H8Z"/><path d="M12 31h20l2 3H10Z"/>';
  const shapes = {
    P: '<circle cx="22" cy="12" r="5.5"/><path d="M18 18h8l-1 5 5 8H14l5-8Z"/>' + base,
    R: '<path d="M12 7h5v5h4V7h4v5h4V7h4v11l-5 4 2 9H14l2-9-4-4Z"/>' + base + `<path d="M16 18h13" fill="none" stroke="${accent}"/>`,
    N: '<path d="m12 30 3-8 9-5-6-1-5 4-5-4 8-9 2-5 5 5 6 2 5 9-1 13Z"/>' + base + `<circle cx="22" cy="11" r="1.3" fill="${color === 'w' ? '#283320' : '#d4dfb5'}" stroke="none"/><path d="m28 13 2 8-7 6" fill="none" stroke="${accent}"/>`,
    B: '<path d="M22 4c-2 4-10 8-8 14 1 3 4 4 5 6l-5 7h16l-5-7c1-2 4-3 5-6 2-6-6-10-8-14Z"/>' + base + `<path d="m23 10-6 8" fill="none" stroke="${accent}" stroke-width="2"/>`,
    Q: '<path d="m11 11 7 7 4-10 4 10 7-7-4 16H15Z"/><circle cx="11" cy="10" r="2.5"/><circle cx="22" cy="7" r="2.5"/><circle cx="33" cy="10" r="2.5"/><path d="M15 27h14l2 4H13Z"/>' + base,
    K: '<path d="M20 3h4v5h5v4h-5v5h-4v-5h-5V8h5Z"/><path d="M15 17c-6-7-11 3-3 10l2 4h16l2-4c8-7 3-17-3-10l-7 4Z"/>' + base,
  };
  const body = `<g fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${shapes[type] || shapes.P}</g>`;
  return nested ? `<svg viewBox="0 0 44 44" aria-hidden="true">${body}</svg>` : body;
}

function avatar(mood) {
  const angry = mood >= 50;
  return `<svg viewBox="0 0 68 68"><path d="m34 2 28 16v32L34 66 6 50V18Z" fill="${angry ? '#b99570' : '#c5cd9d'}"/><path d="m20 25 5-10 16-2 8 11-2 23-13 10-13-9Z" fill="#293425"/><path d="m21 24 5-7 15-1 6 9-3-4-6 2-6-2-5 4Z" fill="#687451"/><path d="${angry ? 'm24 30 7 3m7 0 7-3' : 'm25 31 6-1m7 0 6 1'}" fill="none" stroke="#d7deb4" stroke-width="2.5" stroke-linecap="round"/><path d="m33 33-2 7h6M28 45q6 ${angry ? '-3' : '4'} 12 0" fill="none" stroke="#9cab7a" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="50" r="3" fill="#d3e98a"/></svg>`;
}

function setHelper(text, error = false) {
  $('helper-text').textContent = text;
  $('helper-text').classList.toggle('has-error', error);
}

function renderBoard() {
  const priorFocus = document.activeElement?.closest?.('[data-cell]')?.dataset.cell;
  const legal = selected && game.turn === 'w' && !thinking && !game.result ? getLegalMoves(game, selected) : [];
  const targets = new Set(legal.map((move) => move.to));
  const check = isInCheck(game, game.turn);
  const last = game.lastMove;
  const colors = ['#b9c19b', '#89976d', '#d5d6b5'];
  const s = 33;
  const polygon = Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 180 * (60 * i - 30);
    return `${Math.cos(angle) * s},${Math.sin(angle) * s}`;
  }).join(' ');
  $('board').innerHTML = CELLS.map(({ q, r }) => {
    const cell = key(q, r);
    const x = Math.sqrt(3) * s * (q + r / 2);
    const y = s * 1.5 * r;
    const p = game.pieces[cell];
    const classes = ['hex-cell', selected === cell ? 'selected' : '', last && [last.from, last.to].includes(cell) ? 'last' : '', suggested && [suggested.from, suggested.to].includes(cell) ? 'hinted' : '', check && p?.type === 'K' && p.color === game.turn ? 'king-check' : ''].filter(Boolean).join(' ');
    const label = `${coords(cell)}${p ? `, ${p.color === 'w' ? 'белые' : 'чёрные'}, ${pieceName(p.type)}` : ', пустая клетка'}${targets.has(cell) ? ', допустимый ход' : ''}`;
    return `<g class="${classes}" transform="translate(${x} ${y})" role="button" tabindex="${cell === focusCell ? 0 : -1}" data-cell="${cell}" aria-label="${escape(label)}" aria-pressed="${selected === cell}"><polygon class="tile" points="${polygon}" fill="${colors[((q - r) % 3 + 3) % 3]}"/><text class="coord" x="0" y="26" text-anchor="middle">${coords(cell)}</text>${p ? `<g class="piece" transform="translate(-20,-24) scale(.91)">${pieceSVG(p.type, p.color)}</g>` : ''}${targets.has(cell) ? p ? '<circle class="capture-ring" r="25"/>' : '<circle class="move-dot" r="6"/>' : ''}</g>`;
  }).join('');
  if (priorFocus) $('board').querySelector(`[data-cell="${priorFocus}"]`)?.focus({ preventScroll: true });
}

function render() {
  const chapter = getChapter(settled ? { ...campaign, played: Math.max(0, campaign.played - 1), wins: Math.max(0, campaign.wins - (game.result?.winner === 'w' ? 1 : 0)) } : campaign);
  const finished = campaign.wins >= 10;
  $('chapter-title').innerHTML = finished ? 'Десять побед.<br><span>Ни одного оправдания.</span>' : campaign.played >= 3 ? 'Его игра.<br><span>Ваши победы.</span>' : 'Обычные шахматы.<br><span>Пока что.</span>';
  $('chapter-subtitle').textContent = finished ? 'Вы выдержали все реванши. Даже когда правила были против вас.' : chapter.subtitle;
  $('round-label').textContent = `ПАРТИЯ ${pad(campaign.played + (settled ? 0 : 1))}`;
  $('game-type').textContent = chapter.tutorial && !settled ? 'РАЗМИНКА' : 'РЕВАНШ';
  let status = settled ? game.result?.winner === 'w' ? 'ВАША ПОБЕДА' : game.result?.winner === 'b' ? 'ПАРТИЯ ПРОИГРАНА' : 'НИЧЬЯ' : thinking || game.turn === 'b' ? 'СОПЕРНИК ДУМАЕТ' : isInCheck(game, 'w') ? 'ВАМ ШАХ' : 'ВАШ ХОД';
  $('turn-label').innerHTML = `<span class="live-dot"></span>${status}`;
  $('turn-label').classList.toggle('thinking', thinking || (!settled && game.turn === 'b'));
  $('turn-label').classList.toggle('check', !settled && game.turn === 'w' && isInCheck(game, 'w'));
  $('move-number').textContent = `Ход ${Math.floor(game.ply / 2) + 1}`;
  $('selected-label').textContent = selected && game.pieces[selected] ? `${pieceName(game.pieces[selected].type)} · ${coords(selected)}` : settled ? 'Партия окончена' : 'Выберите фигуру';
  $('opponent-avatar').innerHTML = avatar(chapter.moodLevel);
  $('mood-label').textContent = chapter.mood;
  $('opponent-level').textContent = roman[chapter.level];
  $('opponent-level').setAttribute('aria-label', `Сила соперника ${chapter.level} из 10`);
  $('opponent-quote').textContent = quote || chapter.quote;
  $('temper-fill').style.width = `${Math.max(4, 100 - chapter.moodLevel)}%`;
  $('temper-fill').style.background = chapter.moodLevel > 60 ? 'var(--red)' : 'var(--lime)';
  $('temper-label').textContent = chapter.moodLevel > 80 ? 'на пределе' : chapter.moodLevel > 55 ? 'даёт трещину' : chapter.moodLevel > 25 ? 'держится из последних сил' : 'пока в порядке';
  $('wins-number').textContent = pad(campaign.wins);
  $('played-number').textContent = campaign.played;
  $('progress-caption').innerHTML = finished ? 'Вы сделали это.<br>Он запомнит.' : campaign.wins === 0 ? 'Первый шаг —<br>первый мат.' : `Ещё ${10 - campaign.wins}<br>до финала.`;
  $('win-track').innerHTML = Array.from({ length: 10 }, (_, i) => `<span class="win-marker ${i < campaign.wins ? 'complete' : i === campaign.wins ? 'next' : ''}" title="Победа ${i + 1}">${i < campaign.wins ? '✓' : i + 1}</span>`).join('');
  $('win-track').setAttribute('aria-label', `${campaign.wins} из 10 побед`);
  $('rule-count').textContent = pad(1 + chapter.ruleCards.length);
  $('active-rules-list').innerHTML = `<div class="rule-card"><span class="rule-symbol" aria-hidden="true">⬡</span><div><h3>Шахматы на гексах</h3><p>Знакомые фигуры на шестиугольной доске. Побеждает тот, кто ставит мат.</p></div></div>` + chapter.ruleCards.map((rule) => `<div class="rule-card ${rule.introduced ? 'introduced' : ''}"><span class="rule-symbol" aria-hidden="true">${rule.id === 'backwardPawns' ? '↶' : rule.id === 'longKing' ? '♔' : '♞'}</span><div><h3>${escape(rule.title)}</h3><p>${escape(rule.description)}</p></div></div>`).join('');
  $('rules-teaser').textContent = campaign.played >= 7 ? 'Он переписал всё, что смог. Теперь ваш ход.' : campaign.played >= 3 ? 'Новые правила действуют на обе стороны. Пользуйтесь.' : 'Пока всё по-честному. Кажется.';
  $('tutorial-note').hidden = !chapter.tutorial || settled;
  $('hint-button').disabled = !settled && (thinking || game.turn !== 'w');
  $('hint-button').innerHTML = settled ? finished ? '✳ Итог истории' : 'Ещё одну →' : '<span aria-hidden="true">✧</span> Подсказка';
  $('resign-button').disabled = thinking || settled || finished;
  $('sound-button').setAttribute('aria-pressed', String(sound));
  $('sound-label').textContent = sound ? 'Звук вкл.' : 'Звук выкл.';
  if (!storageAvailable) {
    setHelper('Браузер не разрешает сохранение. Прогресс доступен до закрытия вкладки.');
    $('helper-text').classList.add('storage-notice');
  } else $('helper-text').classList.remove('storage-notice');
  renderBoard();
}

function playSound(kind) {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    const frequencies = kind === 'win' ? [392, 523.25, 659.25] : kind === 'capture' ? [196, 146.8] : [330];
    frequencies.forEach((f, i) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t + i * .09);
      gain.gain.exponentialRampToValueAtTime(.085, t + i * .09 + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, t + i * .09 + .2);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(t + i * .09); oscillator.stop(t + i * .09 + .21);
    });
  } catch { /* Audio is optional: gameplay always remains available. */ }
}

function openModal(content, { locked = false } = {}) {
  const modal = $('modal');
  $('modal-content').innerHTML = `<div class="modal-inner">${content}</div>`;
  modal.dataset.locked = String(locked);
  if (!modal.open) modal.showModal();
}
function closeModal() { $('modal').close(); }
function button(id, label, primary = true) { return `<button id="${id}" class="${primary ? 'primary-button' : 'secondary-button'}" type="button">${label}</button>`; }

function announceRule() {
  const chapter = getChapter(campaign);
  if (!chapter.newRule) return false;
  const rule = chapter.newRule;
  quote = rule.quote || chapter.quote;
  render();
  openModal(`<p class="modal-eyebrow">ПОСЛЕ ${campaign.played} ПАРТИЙ — НОВЫЕ УСЛОВИЯ</p><span class="modal-icon" aria-hidden="true">↶</span><h2 id="modal-title">«Правила меняются».</h2><p>${escape(rule.quote || chapter.quote)}</p><div class="rule-announcement"><strong>${escape(rule.title)}</strong><br>${escape(rule.description)}</div><p>Правило действует для обоих игроков и сохраняется в следующих партиях. Остальные изменения остаются в силе.</p><div class="modal-actions">${button('accept-rule', 'Ладно. Ещё одну →')}</div>`, { locked: true });
  $('accept-rule').onclick = () => {
    campaign.rulesAcceptedFor = rule.threshold;
    persist(); closeModal();
    if (announceRule()) return;
    render();
    if (game.turn === 'b' && !settled) requestAI();
  };
  return true;
}

function beginRound() {
  aiRequest++; clearTimeout(aiTimer);
  thinking = false; settled = false; selected = null; suggested = null;
  const chapter = getChapter(campaign);
  game = createGame({ tutorial: chapter.tutorial, rules: chapter.rules });
  focusCell = '0,0'; quote = chapter.quote;
  setHelper('Нажмите на белую фигуру, чтобы увидеть её ходы.');
  persist(); render();
  announceRule();
}

function showResult() {
  const win = game.result?.winner === 'w';
  const loss = game.result?.winner === 'b';
  const finished = campaign.wins >= 10;
  const reason = game.result?.reason;
  const reasons = { checkmate: win ? 'Мат. Эта партия ваша.' : 'Мат. Соперник оказался сильнее.', stalemate: 'Пат: допустимых ходов нет, но король не под шахом.', 'fifty-move': 'Ничья: 50 ходов без взятий и движения пешек.', 'insufficient-material': 'На доске недостаточно фигур для мата.', resignation: 'Партия завершена сдачей.', repetition: 'Ничья: позиция повторилась три раза.' };
  openModal(`<p class="modal-eyebrow">${finished ? 'ИСТОРИЯ ПРОЙДЕНА' : `ПАРТИЯ ${pad(campaign.played)} ЗАВЕРШЕНА`}</p><span class="modal-icon" aria-hidden="true">${finished ? '♔' : win ? '✳' : loss ? '↗' : '＝'}</span><h2 id="modal-title">${finished ? 'Десять. Ты доволен?' : win ? 'Ваша победа.' : loss ? 'Реванш за вами.' : 'Пожалуй, ничья.'}</h2><p>${finished ? 'Он усиливал игру. Переписывал правила. Требовал реваншей. Вы всё равно победили десять раз.' : escape(reasons[reason] || 'Партия завершена.')}</p><div class="modal-score">${pad(campaign.wins)} <span>/ 10 побед</span></div><p>«${escape(quote)}»</p><div class="modal-actions">${button('next-round', finished ? 'Посмотреть итоговую доску' : 'Ещё одну →')}${button('review-board', 'Посмотреть доску', false)}</div>`, { locked: false });
  $('review-board').onclick = closeModal;
  if (finished) $('review-board').hidden = true;
  $('next-round').onclick = () => { closeModal(); if (!finished) beginRound(); };
}

function completeRound() {
  if (settled || !game.result) return;
  const win = game.result.winner === 'w';
  campaign = recordResult(campaign, win ? 'win' : game.result.winner === 'b' ? 'loss' : 'draw');
  settled = true; thinking = false; aiRequest++; clearTimeout(aiTimer); selected = null; suggested = null;
  quote = campaign.wins >= 10 ? 'Ладно. Ты выиграл. Но это ещё не значит, что я проиграл.' : win ? campaign.played >= 3 ? 'Это случайность. Я просто ещё не придумал нужное правило.' : 'Так. Неплохо. Давай ещё одну? Теперь я серьёзно.' : game.result.winner === 'b' ? 'Ну вот. Я же говорил, что просто разминаюсь. Ещё одну?' : 'Это не считается поражением. Ни твоим, ни моим. Переиграем.';
  playSound(win ? 'win' : 'capture');
  setHelper(campaign.wins >= 10 ? 'Все десять побед ваши. История завершена.' : 'Партия окончена. Нажмите «Ещё одну», чтобы продолжить.');
  persist(); render(); showResult();
}

function afterMove(move, isAI = false) {
  const capture = Boolean(game.pieces[move.to]);
  const next = applyMove(game, move);
  if (!next) return false;
  game = next; selected = null; suggested = null; thinking = false;
  playSound(capture ? 'capture' : 'move');
  if (isAI && capture) quote = campaign.played >= 3 ? 'Вот так. Привыкай к новым правилам.' : 'Всего лишь маленькое взятие. Не переживай.';
  else if (isAI && isInCheck(game, 'w')) quote = 'Шах. Теперь внимательно.';
  persist(); render();
  if (game.result) { completeRound(); return true; }
  setHelper(isAI ? isInCheck(game, 'w') ? 'Ваш король под шахом. Подсвечиваются только ходы, которые его спасают.' : `Соперник: ${coords(move.from)} → ${coords(move.to)}. Ваш ход.` : 'Соперник обдумывает ответ…');
  if (game.turn === 'b') requestAI();
  return true;
}

function receiveAI(data) {
  if (data.id !== aiRequest || settled || game.turn !== 'b') return;
  if (data.error || !data.move || !afterMove(data.move, true)) {
    thinking = false;
    const legal = getLegalMoves(game);
    // A worker failure cannot leave the board permanently blocked.
    if (legal.length) afterMove(legal[0], true);
    else { game = { ...game, result: { winner: isInCheck(game, 'b') ? 'w' : null, reason: isInCheck(game, 'b') ? 'checkmate' : 'stalemate' } }; completeRound(); }
  }
}

function requestAI() {
  if (settled || game.turn !== 'b' || thinking || $('modal').open) return;
  thinking = true; selected = null;
  const id = ++aiRequest;
  render();
  aiTimer = setTimeout(() => {
    if (id !== aiRequest || settled) return;
    const level = getChapter(campaign).level;
    if (worker) worker.postMessage({ id, game, level });
    else {
      try { receiveAI({ id, move: chooseAIMove(game, { level }) }); }
      catch (error) { receiveAI({ id, error: error.message }); }
    }
  }, 550);
}

function clickCell(cell) {
  if (settled || thinking || game.turn !== 'w' || $('modal').open) return;
  focusCell = cell;
  if (selected) {
    const move = getLegalMoves(game, selected).find((candidate) => candidate.to === cell);
    if (move) { afterMove(move); return; }
  }
  const p = game.pieces[cell];
  if (p?.color === 'w') {
    selected = selected === cell ? null : cell;
    suggested = null;
    const moves = selected ? getLegalMoves(game, selected) : [];
    setHelper(selected ? moves.length ? `${pieceName(p.type)}: выберите одну из ${moves.length} подсвеченных клеток.` : 'У этой фигуры сейчас нет допустимых ходов. Выберите другую.' : 'Выберите белую фигуру.');
  } else {
    if (selected) setHelper('Сюда ходить нельзя. Выберите подсвеченную клетку или другую белую фигуру.');
    else setHelper(p ? 'Это фигура соперника. Вы играете белыми.' : 'Сначала выберите белую фигуру.');
  }
  render();
}

function hint() {
  if (settled) { if (campaign.wins >= 10) showResult(); else beginRound(); return; }
  if (thinking || settled || game.turn !== 'w') return;
  suggested = getHint(game);
  if (suggested) {
    selected = suggested.from;
    focusCell = suggested.from;
    setHelper(`Попробуйте: ${pieceName(game.pieces[suggested.from].type)} ${coords(suggested.from)} → ${coords(suggested.to)}. Золотом отмечены обе клетки.`);
    render();
  }
}

function showRules() {
  const rules = game.rules;
  openModal(`<button class="modal-close" id="close-rules" type="button" aria-label="Закрыть">×</button><p class="modal-eyebrow">КОРОТКО О ГЛАВНОМ</p><h2 id="modal-title">Шахматы.<br>С шестью сторонами.</h2><p>Вы играете <strong>белыми</strong> и ходите первыми. Нажмите на свою фигуру — затем на подсвеченную клетку. Цель партии — поставить мат. Цель истории — <strong>10 побед суммарно</strong>.</p><p>Это собственная адаптация шахмат на доске из 61 гекса. Здесь нет рокировки, взятия на проходе и двойного первого хода пешки. Дойдя до противоположного края, пешка автоматически становится ферзём.</p><div class="glossary">${['K', 'Q', 'R', 'B', 'N', 'P'].map((type) => `<div class="glossary-row"><span class="glossary-piece">${pieceSVG(type, 'w', true)}</span><div><h3>${pieceName(type)}</h3><p>${escape(describePiece(type, rules))}</p></div></div>`).join('')}</div><p>Шах нельзя игнорировать. Короля не берут: партия заканчивается матом. Пат, голые короли, троекратное повторение и 50 ходов без пешек и взятий дают ничью.</p><p>После третьей сыгранной партии соперник начинает переписывать правила. Все изменения объявляются перед реваншем, действуют для обоих игроков и остаются видны рядом с доской. Поражения не обнуляют победы.</p><div class="modal-actions">${button('understood-rules', 'Понятно. За доску →')}</div>`);
  $('close-rules').onclick = closeModal;
  $('understood-rules').onclick = closeModal;
}

function resetStory() {
  openModal(`<p class="modal-eyebrow">НОВАЯ ИСТОРИЯ</p><h2 id="modal-title">С чистой доски?</h2><p>Счёт побед, текущая партия и все новые правила сбросятся. Соперник снова будет уверен, что он здесь главный.</p><div class="modal-actions">${button('confirm-reset', 'Начать заново')}${button('cancel-reset', 'Продолжить историю', false)}</div>`);
  $('confirm-reset').onclick = () => { closeModal(); campaign = freshCampaign(); beginRound(); };
  $('cancel-reset').onclick = closeModal;
}

$('board').addEventListener('click', (event) => {
  const target = event.target.closest('[data-cell]');
  if (target) clickCell(target.dataset.cell);
});
$('board').addEventListener('keydown', (event) => {
  const cell = event.target.closest('[data-cell]')?.dataset.cell;
  if (!cell) return;
  if (['Enter', ' '].includes(event.key)) { event.preventDefault(); clickCell(cell); return; }
  const directions = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  const parsed = parseKey(cell);
  const q = Array.isArray(parsed) ? parsed[0] : parsed.q;
  const r = Array.isArray(parsed) ? parsed[1] : parsed.r;
  const next = key(q + direction[0], r + direction[1]);
  if (cellKeys.has(next)) {
    focusCell = next;
    $('board').querySelectorAll('[data-cell]').forEach((node) => node.setAttribute('tabindex', node.dataset.cell === next ? '0' : '-1'));
    $('board').querySelector(`[data-cell="${next}"]`)?.focus({ preventScroll: true });
  }
});
$('hint-button').onclick = hint;
$('tutorial-hint').onclick = hint;
$('rules-button').onclick = showRules;
$('sound-button').onclick = () => { sound = !sound; playSound('move'); persist(); render(); };
$('reset-button').onclick = resetStory;
$('resign-button').onclick = () => {
  if (thinking || settled) return;
  openModal(`<p class="modal-eyebrow">НЕ КОНЕЦ ИСТОРИИ</p><h2 id="modal-title">Уступить эту партию?</h2><p>Победы останутся на месте. Соперник получит повод позлорадствовать, а вы — новую доску.</p><div class="modal-actions">${button('confirm-resign', 'Да, беру реванш')}${button('cancel-resign', 'Продолжить партию', false)}</div>`);
  $('confirm-resign').onclick = () => { closeModal(); game = { ...game, result: { winner: 'b', reason: 'resignation' } }; completeRound(); };
  $('cancel-resign').onclick = closeModal;
};
$('modal').addEventListener('cancel', (event) => { if ($('modal').dataset.locked === 'true') event.preventDefault(); });
$('modal').addEventListener('click', (event) => { if (event.target === $('modal') && $('modal').dataset.locked !== 'true') closeModal(); });
$('modal').addEventListener('close', () => { if (game?.turn === 'b' && !settled && !thinking) requestAI(); });

try {
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => receiveAI(data);
  worker.onerror = () => {
    worker?.terminate(); worker = null;
    if (thinking && game.turn === 'b' && !settled) {
      thinking = false;
      requestAI();
    }
  };
} catch { worker = null; }

if (!game) beginRound();
else {
  render();
  if (game.result && !settled) completeRound();
  else if (settled) showResult();
  else if (!announceRule() && game.turn === 'b') requestAI();
}
