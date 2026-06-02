/**
 * Scale-adaptive рівень + ризик задачі (ідея з BMAD project-levels/risk-profile,
 * у наших термінах). `init` визначає рівень і ризик за описом; разом вони
 * right-size'ять, скільки adversarial-рецензентів спавнить `flow review` (і його
 * фокус), і які фази рекомендовані (контракт).
 *
 * Детекція — підрядками (case-insensitive), без regex (уникаємо slow-regex і
 * проблем зі словомежами для кирилиці).
 */

/** L3 — велике/архітектурне. */
const L3_KEYS = ['platform', 'migration', 'rewrite', 'architecture', 'enterprise', 'редизайн', 'міграц', 'переписат']
/** L0 — тривіальне. ASCII-дієслова: матч цілим словом (щоб `fix` не ловило `prefix`/`fixture`). */
const L0_WORD_KEYS = ['fix', 'typo', 'bump', 'rename', 'hotfix']
/** L0 — кириличні ключі: підрядком (стемінг: `перейменув` ловить `перейменування`). */
const L0_SUBSTR_KEYS = ['опечат', 'перейменув']
/** L2 — багатофайлова фіча/рефактор. */
const L2_KEYS = ['feature', 'epic', 'refactor', 'рефактор', 'фіча']

/**
 * Чи символ — ASCII-літера/цифра (межа слова). `undefined` (край рядка) — не alnum.
 * @param {string | undefined} ch символ
 * @returns {boolean} результат
 */
function isAsciiAlnum(ch) {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))
}

/**
 * Чи містить `text` слово `word` із межами, що не є ASCII-alnum (без regex —
 * конвенція файлу). Для ASCII L0-дієслів: `fix` у `prefix`/`fixture` не рахується.
 * @param {string} text текст (lowercase)
 * @param {string} word шукане ASCII-слово (lowercase)
 * @returns {boolean} результат
 */
function hasWord(text, word) {
  let i = text.indexOf(word)
  while (i !== -1) {
    if (!isAsciiAlnum(text[i - 1]) && !isAsciiAlnum(text[i + word.length])) return true
    i = text.indexOf(word, i + 1)
  }
  return false
}

/**
 * Рівень складності задачі за описом: 0 (тривіальне) … 3 (архітектурне).
 * Пріоритет: L3 > L0 > L2 > дефолт L1.
 * @param {string} desc опис задачі
 * @returns {0 | 1 | 2 | 3} рівень
 */
export function detectLevel(desc) {
  const d = String(desc ?? '').toLowerCase()
  const has = keys => keys.some(k => d.includes(k))
  const isL0 = L0_WORD_KEYS.some(k => hasWord(d, k)) || L0_SUBSTR_KEYS.some(k => d.includes(k))
  if (has(L3_KEYS)) return 3
  if (isL0) return 0
  if (has(L2_KEYS)) return 2
  return 1
}

/**
 * Скільки adversarial-рецензентів спавнити для рівня (глибина review за розміром).
 * @param {number} level рівень 0..3
 * @returns {number} кількість рецензентів (1..3)
 */
export function reviewersForLevel(level) {
  if (level >= 3) return 3
  if (level === 2) return 2
  return 1
}

/** Ключові слова високого ризику (безпека/гроші/доступи). */
const HIGH_RISK_KEYS = ['security', 'auth', 'crypto', 'payment', 'secret', 'token', 'permission', 'password', 'безпек']
/** Ключові слова середнього ризику (дані/незворотність). */
const MED_RISK_KEYS = ['data', ' db', 'database', 'migration', 'delete', 'gateway', 'міграц', 'видален']

/**
 * Рівень ризику задачі за описом: low | med | high.
 * @param {string} desc опис задачі
 * @returns {'low' | 'med' | 'high'} ризик
 */
export function detectRisk(desc) {
  const d = String(desc ?? '').toLowerCase()
  const has = keys => keys.some(k => d.includes(k))
  if (has(HIGH_RISK_KEYS)) return 'high'
  if (has(MED_RISK_KEYS)) return 'med'
  return 'low'
}

/**
 * Скільки рецензентів диктує сам ризик.
 * @param {string} risk low|med|high
 * @returns {number} 1..3
 */
export function reviewersForRisk(risk) {
  if (risk === 'high') return 3
  if (risk === 'med') return 2
  return 1
}

/**
 * Підсумкова глибина review: максимум вимог за рівнем і за ризиком (кап 3).
 * @param {number} level рівень 0..3
 * @param {string} [risk] low|med|high
 * @returns {number} кількість рецензентів (1..3)
 */
export function reviewersFor(level, risk) {
  return Math.min(3, Math.max(reviewersForLevel(level), reviewersForRisk(risk)))
}
