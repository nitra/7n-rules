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
 *
 * Durable-write-и (`recordDurable`): для worker-ів, чиї записи — самодостатні кінцеві
 * стани (кожен файл або записаний повністю й валідний, або не записаний; напр.
 * doc-files: дока зі свіжим CRC, degraded теж валідна за дизайном ADR 260610-2228).
 * Rollback такі шляхи НЕ чіпає — прогрес великого батчу переживає провал/таймаут
 * rung-а, а canonical re-detect рахує лише те, що реально лишилось. Для решти
 * concern-ів rollback-контракт незмінний.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

/** Маркер «файл не існував на момент snapshot». */
const ABSENT = Symbol('absent')

/**
 * @typedef {object} PreImageTracker
 * @property {(absPath: string) => void} record зафіксувати pre-image (idempotent per path)
 * @property {(absPath: string) => void} recordDurable позначити шлях durable: запис —
 *   самодостатній кінцевий стан; rollback його не чіпає, semantic-collateral veto не бачить
 * @property {() => void} rollback відновити всі записані pre-images (крім durable)
 * @property {() => string[]} touched список абсолютних шляхів, для яких знято pre-image
 *   або зроблено durable-позначку
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
  /** Durable-шляхи: оголошені worker-ом самодостатні кінцеві стани — поза rollback/veto. */
  const durable = new Set()

  return {
    record(absPath) {
      if (preImages.has(absPath)) return
      preImages.set(absPath, existsSync(absPath) ? readFileSync(absPath, 'utf8') : ABSENT)
    },
    recordDurable(absPath) {
      durable.add(absPath)
    },
    rollback() {
      for (const [absPath, pre] of preImages) {
        if (durable.has(absPath)) continue
        if (pre === ABSENT) {
          if (existsSync(absPath)) rmSync(absPath, { force: true })
        } else {
          mkdirSync(dirname(absPath), { recursive: true })
          writeFileSync(absPath, pre, 'utf8')
        }
      }
    },
    touched() {
      return [...new Set([...preImages.keys(), ...durable])]
    },
    modifiedExisting() {
      // Кожен rung стартує з S1 (rollback на провалі), тому diff проти pre-image —
      // це правки саме поточного rung-а. Видалений наявний файл теж «змінений».
      // Durable-шляхи виключені: це оголошені worker-ом цільові артефакти (доки поряд
      // із кодом), а не collateral; вердикт по них однаково дає canonical re-detect.
      return [...preImages]
        .filter(
          ([abs, pre]) => pre !== ABSENT && !durable.has(abs) && (!existsSync(abs) || readFileSync(abs, 'utf8') !== pre)
        )
        .map(([abs]) => abs)
    }
  }
}
