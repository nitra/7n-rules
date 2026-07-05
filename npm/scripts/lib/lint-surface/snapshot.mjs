/**
 * Central pre-image snapshot/rollback для fix-pipeline (spec 2026-06-29, §Tier Ladder).
 *
 * Rollback НІКОЛИ не означає `rm generated files` наосліп: він відновлює pre-image
 * для змінених файлів і видаляє лише ті, яких не існувало на момент snapshot-а.
 *
 * Виконання послідовне (один concern за раз), тому snapshot береться свіжим перед
 * ladder-ом кожного concern-а і вже містить успішні зміни попередніх concern-ів —
 * rollback одного concern-а не може зачепити результат іншого.
 *
 * T0 і worker funnel-ять записи через `tracker.record(absPath)` ПЕРЕД мутацією,
 * тож tracker знає pre-image кожного потенційно зміненого файлу.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

/** Маркер «файл не існував на момент snapshot». */
const ABSENT = Symbol('absent')

/**
 * @typedef {object} PreImageTracker
 * @property {(absPath: string) => void} record зафіксувати pre-image (idempotent per path)
 * @property {() => void} rollback відновити всі записані pre-images
 * @property {() => string[]} touched список абсолютних шляхів, для яких знято pre-image
 * @property {() => string[]} modifiedExisting наявні на момент S1 файли, чий поточний
 *   вміст відрізняється від pre-image (вхід semantic-collateral veto; нові файли не входять)
 */

/**
 * Створює tracker зі свіжим (порожнім) набором pre-images — це і є snapshot S1.
 * @returns {PreImageTracker} трекер pre-images із методами capture/touched.
 */
export function createSnapshot() {
  /** @type {Map<string, string | typeof ABSENT>} */
  const preImages = new Map()

  return {
    record(absPath) {
      if (preImages.has(absPath)) return
      preImages.set(absPath, existsSync(absPath) ? readFileSync(absPath, 'utf8') : ABSENT)
    },
    rollback() {
      for (const [absPath, pre] of preImages) {
        if (pre === ABSENT) {
          if (existsSync(absPath)) rmSync(absPath, { force: true })
        } else {
          mkdirSync(dirname(absPath), { recursive: true })
          writeFileSync(absPath, pre, 'utf8')
        }
      }
    },
    touched() {
      return preImages.keys().toArray()
    },
    modifiedExisting() {
      // Кожен rung стартує з S1 (rollback на провалі), тому diff проти pre-image —
      // це правки саме поточного rung-а. Видалений наявний файл теж «змінений».
      return [...preImages]
        .filter(([abs, pre]) => pre !== ABSENT && (!existsSync(abs) || readFileSync(abs, 'utf8') !== pre))
        .map(([abs]) => abs)
    }
  }
}
