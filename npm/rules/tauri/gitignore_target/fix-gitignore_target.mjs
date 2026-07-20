/** @see ./docs/fix-gitignore_target.md */

/**
 * T0-autofix для `tauri/gitignore_target` — детерміновано дописує в корінний
 * `.gitignore` відсутні ignore-записи `<ws>/src-tauri/target/` (з violation.data.missing,
 * а не з повторного сканування монорепо — детектор уже визначив, яких саме
 * записів бракує). Текстовий splice (як `tauri/linux_deps`): зберігає коментарі
 * й формат, мінімальний diff. Ідемпотентно: повторний прогін на вже
 * виправленому файлі нічого не змінює (`findMissingEntries` у main.mjs
 * повторно перевіряє стан файла).
 */
import { applyToFiles } from '../../../scripts/utils/apply-to-files.mjs'

import { MISSING_GITIGNORE_TARGET_ENTRIES } from './main.mjs'

/** Заголовок-коментар секції Tauri build-артефактів у корінному `.gitignore`. */
export const GITIGNORE_TARGET_HEADER = '# Tauri — Rust build artifacts (tauri.mdc)'

/**
 * Знаходить кінець контурного блоку entries, що йде одразу за заголовком
 * (перший порожній рядок, наступний коментар або кінець файла).
 * @param {string[]} lines рядки `.gitignore`
 * @param {number} headerIdx індекс рядка заголовка
 * @returns {number} індекс, куди вставляти нові entries
 */
function findBlockEnd(lines, headerIdx) {
  let i = headerIdx + 1
  while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('#')) i++
  return i
}

/**
 * Дописує відсутні `<ws>/src-tauri/target/` entries: якщо секція `GITIGNORE_TARGET_HEADER`
 * вже є — вставляє в кінець її блоку (поруч з наявними entries); інакше додає
 * новий блок (заголовок + entries) у кінець файла.
 * @param {string} content вміст `.gitignore`
 * @param {string[]} missingEntries відсутні ignore-рядки (`<ws>/src-tauri/target/`)
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function insertMissingTargetEntries(content, missingEntries) {
  if (missingEntries.length === 0) return null

  const lines = content.split('\n')
  const headerIdx = lines.findIndex(l => l.trim() === GITIGNORE_TARGET_HEADER)

  if (headerIdx !== -1) {
    const blockEnd = findBlockEnd(lines, headerIdx)
    lines.splice(blockEnd, 0, ...missingEntries)
    return lines.join('\n')
  }

  const trailingBlank = lines.length > 0 && lines.at(-1) === ''
  const body = trailingBlank ? lines.slice(0, -1) : lines
  const needsBlankSep = body.length > 0 && body.at(-1).trim() !== ''

  const next = [...body]
  if (needsBlankSep) next.push('')
  next.push(GITIGNORE_TARGET_HEADER, ...missingEntries, '')
  return next.join('\n')
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'tauri-gitignore-target-insert',
    test: violations => violations.some(v => v.data?.kind === MISSING_GITIGNORE_TARGET_ENTRIES && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_GITIGNORE_TARGET_ENTRIES && v.file)
      const touchedFiles = applyToFiles(targets, ctx, rel => content => {
        const v = targets.find(x => x.file === rel)
        return insertMissingTargetEntries(content, v?.data?.missing ?? [])
      })
      return touchedFiles.length > 0
        ? { touchedFiles, message: `Tauri build-артефакти → .gitignore (${touchedFiles.length} file(s))` }
        : { touchedFiles: [] }
    }
  }
]
