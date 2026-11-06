/** Campaign state and dialogue. No DOM or storage side effects. */
export const STORAGE_KEY = 'sah-campaign-v1';

const RESULTS = new Set(['win', 'loss', 'draw']);
const RULE_STAGES = [
  {
    id: 'backwardPawns',
    threshold: 3,
    title: 'Пешки идут назад',
    description: 'Пешки обеих сторон могут отступать на одну клетку и брать назад. Обычные ходы остаются.',
    quote: 'Три партии по твоим правилам — достаточно. Теперь пешки ходят назад. И берут тоже.',
  },
  {
    id: 'longKing',
    threshold: 5,
    title: 'Королю тесно',
    description: 'Короли обеих сторон могут пройти две клетки по прямой через общие стороны. Путь должен быть свободен и безопасен.',
    quote: 'Почему король должен плестись по одной клетке? Теперь он может пройти две. Запоминай.',
  },
  {
    id: 'knightCrown',
    threshold: 7,
    title: 'Конь без ограничений',
    description: 'Кони обеих сторон сохраняют прыжки и дополнительно могут шагнуть на соседнюю клетку через общую сторону.',
    quote: 'А конь теперь ещё и ходит рядом. Что? На моей доске это совершенно нормально.',
  },
];

export function freshCampaign() {
  return { wins: 0, played: 0, history: [], rulesAcceptedFor: 0 };
}

const safeInt = (value, fallback = 0) =>
  Number.isSafeInteger(value) && value >= 0 ? value : fallback;

/** Treat localStorage as untrusted input and always return independent data. */
export function normalizeCampaign(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return freshCampaign();
  const wins = Math.min(10, safeInt(raw.wins));
  const played = Math.min(1_000_000, Math.max(wins, safeInt(raw.played)));
  const requestedAcceptance = safeInt(raw.rulesAcceptedFor);
  const rulesAcceptedFor = RULE_STAGES.reduce(
    (accepted, rule) => rule.threshold <= played && rule.threshold <= requestedAcceptance
      ? rule.threshold : accepted,
    0,
  );
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter(item => item && typeof item === 'object'
      && Number.isSafeInteger(item.round) && item.round > 0 && item.round <= played
      && RESULTS.has(item.result))
    .slice(-20)
    .map(({ round, result }) => ({ round, result }));
  return { wins, played, history, rulesAcceptedFor };
}

export function recordResult(campaign, result) {
  if (!RESULTS.has(result)) throw new RangeError('Unknown match result');
  const current = normalizeCampaign(campaign);
  const played = current.played + 1;
  return {
    ...current,
    played,
    wins: Math.min(10, current.wins + (result === 'win' ? 1 : 0)),
    history: [...current.history, { round: played, result }].slice(-20),
  };
}

function dialogue(campaign) {
  const { played, wins } = campaign;
  if (wins >= 10) return {
    title: 'Десять побед. Точка.',
    subtitle: 'Он менял правила. Ты всё равно выиграл.',
    mood: 'Поражение принято', moodLevel: 100,
    quote: 'Десять… Ладно. На этот раз — без «ещё одной». Ты выиграл.',
  };
  if (played === 0) return {
    title: 'Начнём с простого.',
    subtitle: 'Короткая разминка. Найди мат в один ход.',
    mood: 'Спокоен', moodLevel: 5,
    quote: 'Ну что, сыграем? Для начала — маленькая разминка. Здесь есть мат в один ход.',
  };
  if (played === 1) return {
    title: 'Ещё одну?',
    subtitle: 'Разминка позади. Соперник просит реванш.',
    mood: 'Уверен в себе', moodLevel: 15,
    quote: 'Это была разминка. Давай ещё одну — теперь я хотя бы посмотрю на доску.',
  };
  if (played === 2) return {
    title: 'Просто повезло.',
    subtitle: 'Соперник начинает следить за твоими ходами.',
    mood: 'Раздражён', moodLevel: 30,
    quote: 'Не спеши радоваться. Ещё одну. Я начинаю понимать, как ты играешь.',
  };
  if (played < 5) return {
    title: 'Моя доска. Мои правила.',
    subtitle: 'Три партии позади. Соперник переписывает правила.',
    mood: 'Злится', moodLevel: 52,
    quote: 'Не нравится, как всё идёт. Меняем правила: пешки теперь могут отступать. Обе стороны, если тебе так спокойнее.',
  };
  if (played < 7) return {
    title: 'Королю здесь тесно.',
    subtitle: 'Старые изменения остаются. Появляется новое.',
    mood: 'Выходит из себя', moodLevel: 70,
    quote: 'Опять этот король еле ползает. Исправлено: теперь можно пройти две клетки. Продолжаем.',
  };
  if (played < 9) return {
    title: 'Я ещё не закончил.',
    subtitle: 'Конь получает новый ход. Соперник — новый повод спорить.',
    mood: 'В ярости', moodLevel: 88,
    quote: 'Никаких пауз. Кони теперь могут ходить и на соседние клетки. Сыграем ещё раз.',
  };
  return {
    title: wins === 9 ? 'Осталась одна победа.' : 'Он всё ещё здесь.',
    subtitle: 'Все новые правила действуют. Соперник играет в полную силу.',
    mood: 'На пределе', moodLevel: 98,
    quote: wins === 9
      ? 'Девять? Ты считаешь? Ну давай. Попробуй выиграть десятую.'
      : 'Думаешь, привык к новым правилам? Хорошо. Теперь я играю всерьёз.',
  };
}

export function getChapter(rawCampaign) {
  const campaign = normalizeCampaign(rawCampaign);
  const activeStages = RULE_STAGES.filter(rule => campaign.played >= rule.threshold);
  const pending = activeStages.filter(rule => campaign.rulesAcceptedFor < rule.threshold);
  const newRule = campaign.wins < 10 && pending.length ? { ...pending.at(-1) } : null;
  const rules = Object.fromEntries(RULE_STAGES.map(rule => [rule.id, campaign.played >= rule.threshold]));
  const scene = dialogue(campaign);
  return {
    round: campaign.played + 1,
    ...scene,
    opponentName: 'Соперник',
    // Losses change the story and rules, but do not punish the player with an AI spike.
    level: Math.min(10, 1 + campaign.wins),
    quote: newRule ? newRule.quote : scene.quote,
    rules,
    ruleCards: activeStages.map(rule => ({
      id: rule.id,
      threshold: rule.threshold,
      title: rule.title,
      description: rule.description,
      introduced: newRule?.id === rule.id,
    })),
    newRule,
    tutorial: campaign.played === 0,
  };
}

/** Human-facing movements, kept aligned with the small-board hex adaptation. */
export function describePiece(type, rules = {}) {
  const descriptions = {
    K: 'Король: один шаг через общую сторону или вершину. Нельзя вставать под удар.'
      + (rules.longKing ? ' Также можно пройти две клетки по прямой через стороны, если путь свободен и безопасен.' : ''),
    Q: 'Ферзь: на любое расстояние по прямым через стороны или вершины — всего 12 направлений. Через фигуры не проходит.',
    R: 'Ладья: на любое расстояние по шести прямым через общие стороны. Через фигуры не проходит.',
    B: 'Слон: на любое расстояние по шести прямым через общие вершины. Через фигуры не проходит.',
    N: 'Конь: прыгает на три шага, не по прямой; 12 возможных направлений. Может перепрыгивать фигуры.'
      + (rules.knightCrown ? ' Также может сделать один шаг через общую сторону.' : ''),
    P: 'Пешка: один шаг вперёд, берёт по двум передним соседним клеткам. На дальнем краю автоматически становится ферзём.'
      + (rules.backwardPawns ? ' Теперь также может отступить на один шаг и брать по двум задним соседним клеткам.' : ''),
  };
  return descriptions[type] || 'Выбери свою фигуру — доступные ходы подсветятся на доске.';
}
