/**
 * Semantic-collateral veto для verdict-фази fix-pipeline
 * (spec docs/specs/2026-06-26-pi-fix-engine-migration.md §12, addendum 2026-07-05;
 * in-file hunk-level розширення — addendum 2026-07-24 після колатеральної правки, що
 * видалила задокументований обхід реального Bun SQL бага в upsert-order.js).
 *
 * Клас collateral слабких локальних моделей: «виправляючи» правило, модель робить
 * семантичну правку у сторонньому файлі, яка НЕ порушує жодного правила й тому
 * проходить canonical re-detect (живий кейс App.vue: хардкод версії `'0.3.0'` з
 * коментарем "we simulate it being available" замість наявного `await getVersion()`).
 *
 * Правило veto: rung не приймається, якщо він ЗМІНИВ наявний файл поза target-set
 * порушення. Нові файли дозволені — легітимний клас (scaffold, доки поряд із кодом);
 * їх однаково покриває re-check зачеплених файлів і rollback. Порожній target-set
 * (whole-repo концерни без `file` у violations) → veto незастосовний (fail-open,
 * повертає []) — свідомо, щоб не ламати концерни без file-атрибуції.
 *
 * Другий клас collateral (§12 addendum 2026-07-24): rung змінює файл, що ВЖЕ входить
 * у target-set (легітимна ціль порушення), але зачіпає рядки поза ділянкою самого
 * порушення — напр. LLM виправляє відсутній JSDoc над функцією і заодно видаляє сусідній
 * задокументований обхід реального бага усередині тіла тієї самої функції. Cross-file
 * veto вище цього не бачить (файл — законна ціль). {@link findInFileCollateralEdits}
 * рахує грубий (common-prefix/common-suffix, не повний Myers-diff) змінений рядковий
 * діапазон і звіряє його з вікном навколо кожної `violation.data.line` того ж файлу;
 * fail-open, якщо рядок порушення невідомий (немає як відповідально обмежити hunk).
 */
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * realpath шляху з найкращих зусиль: для наявного — повний realpath; для ще-неіснуючого —
 * realpath батьківської теки + basename; інакше — як є. Знімає розбіжність symlink-шляхів
 * (macOS `/tmp` → `/private/tmp`) між snapshot-ключами і target-set (той самий патерн,
 * що у write-guard llm-lib). Експортовано, щоб caller relativize-ив результати veto від
 * так само нормалізованого cwd.
 * @param {string} p шлях
 * @returns {string} нормалізований абсолютний шлях
 */
export function realpathBestEffort(p) {
  try {
    return realpathSync(p)
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p))
    } catch {
      return p
    }
  }
}

/**
 * Нормалізує target-set порушення у множину realpath-абсолютних шляхів — спільна
 * основа і для collateral-veto (файли ПОЗА target-set), і для test-gate
 * (файли ВСЕРЕДИНІ target-set, для яких перевіряються сестринські тести).
 * @param {string[]} targetFiles Файли порушення, відносні до cwd або абсолютні.
 * @param {string} cwd Робоча директорія для резолву відносних шляхів.
 * @returns {Set<string>} Нормалізовані абсолютні шляхи target-set (може бути порожньою).
 */
export function resolveTargetSet(targetFiles, cwd) {
  return new Set(targetFiles.map(f => realpathBestEffort(isAbsolute(f) ? f : resolve(cwd, f))))
}

/**
 * Обчислює collateral-правки rung-а: наявні (на момент S1) файли, змінені поза
 * target-set порушення. Runner на непорожньому результаті відхиляє clean-вердикт
 * rung-а (rollback + feedback + телеметрія `kind:"collateral-veto"`).
 * @param {{ modifiedExisting: string[], targetFiles: string[], cwd: string }} args
 *   modifiedExisting — абсолютні шляхи наявних файлів, змінених відносно S1
 *   (`snapshot.modifiedExisting()`); targetFiles — файли порушення
 *   (`violations[].file ∪ item.files`), відносні до cwd або абсолютні.
 * @returns {string[]} нормалізовані абсолютні шляхи відхилених правок; порожньо —
 *   veto не спрацював (нема collateral або target-set невідомий)
 */
export function findCollateralEdits({ modifiedExisting, targetFiles, cwd }) {
  const targets = resolveTargetSet(targetFiles, cwd)
  if (targets.size === 0) return []
  return modifiedExisting.map(p => realpathBestEffort(p)).filter(abs => !targets.has(abs))
}

/** Дефолтне вікно (рядків з обох боків `violation.data.line`), у межах якого зміна вважається «поруч із порушенням». */
export const HUNK_WINDOW = 20

/**
 * Обчислює грубий змінений рядковий діапазон (1-indexed, у координатах `current`) між
 * pre-image і поточним вмістом файлу: найдовший спільний префікс + найдовший спільний
 * суфікс рядків, все між ними — «змінене». Це НЕ повний diff (не бачить кількох
 * розрізнених hunk-ів як окремих інтервалів — лише зовнішні межі першої і останньої
 * розбіжності), але достатньо, щоб відрізнити «зміна лишилась у ділянці порушення» від
 * «зачепило щось далеко» — для повного Myers-diff тут немає залежності, а точність
 * hunk-рівня явно позначена як бажаний, але не обов'язковий бар (spec §12 addendum
 * 2026-07-24).
 * @param {string} preImage Вміст файлу на момент S1.
 * @param {string} current Поточний вміст файлу.
 * @returns {{ start: number, end: number }|null} діапазон зміни, або null якщо вміст ідентичний.
 */
function changedLineRange(preImage, current) {
  if (preImage === current) return null
  const preLines = preImage.split('\n')
  const curLines = current.split('\n')
  const maxLcp = Math.min(preLines.length, curLines.length)
  let lcp = 0
  while (lcp < maxLcp && preLines[lcp] === curLines[lcp]) lcp++
  const maxLcs = maxLcp - lcp
  let lcs = 0
  while (lcs < maxLcs && preLines[preLines.length - 1 - lcs] === curLines[curLines.length - 1 - lcs]) lcs++
  const start = lcp + 1
  const end = curLines.length - lcs
  return start > end ? null : { start, end }
}

/**
 * In-file hunk-level veto (§12 addendum 2026-07-24): rung змінив файл, що вже входить
 * у target-set порушення, але змінений рядковий діапазон виходить за межі вікна навколо
 * КОЖНОЇ `violation.data.line` цього файлу — сигнал колатеральної правки поза власне
 * порушенням (клас upsert-order.js: LLM видалив сусідній задокументований обхід бага,
 * виправляючи doc-comment над функцією). Fail-open: якщо для файлу немає жодного
 * порушення з відомим `line`, hunk неможливо відповідально обмежити — повертає null.
 * @param {{ preImage: string|null, current: string|null, violationLines: number[], window?: number }} args
 *   preImage/current — вміст файлу до/після rung-а; violationLines — номери рядків
 *   порушень ЦЬОГО rung-а в ЦЬОМУ файлі; window — половина ширини допустимого вікна.
 * @returns {{ start: number, end: number }|null} діапазон відхиленої правки, або null —
 *   veto не спрацював (нема зміни, зміна в межах вікна, або невідома локація порушення).
 */
export function findInFileCollateralEdits({ preImage, current, violationLines, window = HUNK_WINDOW }) {
  if (preImage === null || preImage === undefined || current === null || current === undefined) return null
  if (!violationLines || violationLines.length === 0) return null
  const range = changedLineRange(preImage, current)
  if (!range) return null
  const inWindow = violationLines.some(line => range.start >= line - window && range.end <= line + window)
  return inWindow ? null : range
}
