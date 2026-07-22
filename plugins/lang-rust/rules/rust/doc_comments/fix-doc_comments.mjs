/**
 * T0-autofix для `rust/doc_comments`: механічне «підвищення» суцільного блоку
 * `//`-коментарів до doc-коментаря — `///` над pub-елементом, `//!` для
 * header-блоку на початку файлу. Текст автора зберігається дослівно — T0 нічого
 * не вигадує; порушення без суміжного коментаря лишаються LLM-ladder-у.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PLAIN_COMMENT_PREFIX_RE = /^(\s*)\/\//

/**
 * Підвищує `//`-рядки діапазону до `///` або `//!`.
 * @param {string[]} lines рядки файлу (мутуються)
 * @param {{ fromLine: number, toLine: number, header?: boolean }} block діапазон і тип
 * @returns {void}
 */
export function promoteBlock(lines, block) {
  const marker = block.header ? '//!' : '///'
  for (let i = block.fromLine; i <= block.toLine; i++) {
    lines[i] = lines[i].replace(PLAIN_COMMENT_PREFIX_RE, (_m, indent) => `${indent}${marker}`)
  }
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'promote-line-comments-to-rustdoc',
    test: violations => violations.some(v => v.data?.promotable),
    apply: async (violations, ctx) => {
      const byFile = new Map()
      for (const v of violations) {
        if (!v.data?.promotable) continue
        if (!byFile.has(v.file)) byFile.set(v.file, [])
        byFile.get(v.file).push(v.data)
      }

      const touchedFiles = []
      for (const [file, blocks] of byFile) {
        const absPath = join(ctx.cwd, file)
        const content = await readFile(absPath, 'utf8')
        const lines = content.split('\n')
        for (const block of blocks) promoteBlock(lines, block)
        const next = lines.join('\n')
        if (next === content) continue

        ctx.recordWrite?.(absPath)
        await writeFile(absPath, next, 'utf8')
        touchedFiles.push(absPath)
      }

      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `// → ///|//!: ${touchedFiles.length} файл(ів)` }
    }
  }
]
