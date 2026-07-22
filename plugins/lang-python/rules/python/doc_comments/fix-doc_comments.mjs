/**
 * T0-autofix для `python/doc_comments`: механічне перетворення суцільного
 * `#`-блоку впритул над def/class на docstring одразу після заголовка. Текст
 * автора зберігається дослівно — T0 нічого не вигадує; def/class зовсім без
 * коментаря лишаються LLM-ladder-у. Module-docstring T0 не синтезує (провідний
 * `#`-блок файлу часто shebang/ліцензія, не намір — не ризикуємо).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const COMMENT_PREFIX_RE = /^#\s?/
const INDENT_RE = /^\s*/

/**
 * Будує docstring-рядки з текстів `#`-коментарів (відступ — від першого рядка
 * тіла або 4 пробіли).
 * @param {string[]} texts тексти коментарів без `#`
 * @param {string} indent відступ тіла def/class
 * @returns {string[]} рядки docstring-а
 */
export function buildDocstring(texts, indent) {
  if (texts.length === 1) return [`${indent}"""${texts[0]}"""`]
  return [`${indent}"""${texts[0]}`, ...texts.slice(1).map(t => `${indent}${t}`), `${indent}"""`]
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'promote-comments-to-docstring',
    test: violations => violations.some(v => v.data?.promotable),
    apply: async (violations, ctx) => {
      const byFile = new Map()
      for (const v of violations) {
        if (!v.data?.promotable) continue
        if (!byFile.has(v.file)) byFile.set(v.file, [])
        byFile.get(v.file).push(v.data)
      }

      const touchedFiles = []
      for (const [file, fixes] of byFile) {
        const absPath = join(ctx.cwd, file)
        const content = await readFile(absPath, 'utf8')
        const lines = content.split('\n')
        // Знизу вгору — щоб вставки/видалення не зсували індекси наступних фіксів.
        for (const fix of fixes.toSorted((a, b) => b.headerEnd - a.headerEnd)) {
          const texts = lines.slice(fix.fromLine, fix.toLine + 1).map(l => l.replace(COMMENT_PREFIX_RE, '').trimEnd())
          const bodyLine = lines[fix.headerEnd + 1] ?? ''
          const indent = bodyLine.trim() === '' ? ' '.repeat(4) : (bodyLine.match(INDENT_RE)?.[0] ?? ' '.repeat(4))
          lines.splice(fix.headerEnd + 1, 0, ...buildDocstring(texts, indent))
          lines.splice(fix.fromLine, fix.toLine - fix.fromLine + 1)
        }
        const next = lines.join('\n')
        if (next === content) continue

        ctx.recordWrite?.(absPath)
        await writeFile(absPath, next, 'utf8')
        touchedFiles.push(absPath)
      }

      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `# → docstring: ${touchedFiles.length} файл(ів)` }
    }
  }
]
