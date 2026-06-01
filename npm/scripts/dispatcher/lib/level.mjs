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
/** L0 — тривіальне. */
const L0_KEYS = ['fix', 'typo', 'bump', 'rename', 'hotfix', 'опечат', 'перейменув']
/** L2 — багатофайлова фіча/рефактор. */
const L2_KEYS = ['feature', 'epic', 'refactor', 'рефактор', 'фіча']

/**
 * Рівень складності задачі за описом: 0 (тривіальне) … 3 (архітектурне).
 * Пріоритет: L3 > L0 > L2 > дефолт L1.
 * @param {string} desc опис задачі
 * @returns {0 | 1 | 2 | 3} рівень
 */
export function detectLevel(desc) {
  const d = String(desc ?? '').toLowerCase()
  const has = keys => keys.some(k => d.includes(k))
  if (has(L3_KEYS)) return 3
  if (has(L0_KEYS)) return 0
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
