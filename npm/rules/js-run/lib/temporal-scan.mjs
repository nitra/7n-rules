/**
 * AST-сканер заборони `Temporal` у Bun runtime-коді.
 *
 * Bun 1.3.x ще не має глобального `Temporal`, тому правило js-run забороняє
 * будь-який identifier `Temporal` у backend workspace-коді. Заборона свідомо
 * охоплює polyfill/import-сценарії: у цьому репозиторії канон для часу лишається
 * через `Date` або ін'єкцію timestamp у чисті функції.
 */
import {
  normalizeSnippet,
  offsetToLine,
  parseProgramOrNull,
  walkAstWithAncestors
} from '../../../scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u

/**
 * Знаходить використання identifier `Temporal` у тексті.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/foo.ts`)
 * @returns {{ line: number, snippet: string }[]} список порушень
 */
export function findTemporalUsageInText(content, virtualPath = 'scan.ts') {
  const program = parseProgramOrNull(content, virtualPath)
  if (!program) return []
  /** @type {{ line: number, snippet: string }[]} */
  const out = []
  /** @type {Set<string>} */
  const seen = new Set()
  walkAstWithAncestors(program, [], node => {
    if (node.type !== 'Identifier' || node.name !== 'Temporal') return
    const key = `${node.start}:${node.end}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      line: offsetToLine(content, node.start),
      snippet: normalizeSnippet(content.slice(node.start, node.end))
    })
  })
  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я, виключно з `.d.ts`).
 * @param {string} relativePath відносний шлях до файлу
 * @returns {boolean} `true`, якщо розширення підходить для сканування
 */
export function isTemporalScanSourceFile(relativePath) {
  if (!SOURCE_FILE_RE.test(relativePath)) return false
  return !relativePath.endsWith('.d.ts')
}
