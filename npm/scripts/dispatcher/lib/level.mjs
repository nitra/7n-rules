/**
 * Scale-adaptive рівень задачі (ідея з BMAD project-levels, у наших термінах).
 * `init` визначає рівень за описом; рівень right-size'ить, скільки adversarial-
 * рецензентів спавнить `flow review`, і які фази рекомендовані (контракт).
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
 * Скільки adversarial-рецензентів спавнити для рівня (глибина review за ризиком).
 * @param {number} level рівень 0..3
 * @returns {number} кількість рецензентів (1..3)
 */
export function reviewersForLevel(level) {
  if (level >= 3) return 3
  if (level === 2) return 2
  return 1
}
