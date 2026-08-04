/**
 * T0-autofix для `js/doc_comments`: механічне «підвищення» суцільного блоку
 * `//`-коментарів, що стоїть впритул над експортом (або на початку файлу), до
 * doc-коментаря `/** … *​/`. Текст автора зберігається дослівно — T0 нічого не
 * вигадує; порушення без суміжного коментаря лишаються LLM-ladder-у
 * (default-worker допише описи).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LINE_COMMENT_PREFIX_RE = /^\s*\/\/\s?/
// Guard ідемпотентності: офсети `data.{start,end}` приходять із detect-прогону,
// а до `apply()` файл міг уже змінити ІНШИЙ T0-патерн того самого концерну
// (`applyT0` ганяє ВСІ патерни одним масивом `violations` — після
// wasm-плану `wasm-fix:js/doc_comments` цей фіксер бачить уже підвищений
// `/** … */`). Різати такий зріз як «блок //-коментарів» означало б зіпсувати
// файл, тому підвищується лише зріз, кожен рядок якого ДОСІ починається з `//`.
const LINE_COMMENT_LINE_RE = /^\s*\/\//

/**
 * Перетворює блок `//`-рядків на JSDoc, зберігаючи відступ першого рядка.
 * @param {string} block текст блоку (від початку першого `//` до кінця останнього)
 * @param {string} indent відступ, з яким стояв блок
 * @returns {string} JSDoc-блок
 */
export function promoteLineBlock(block, indent) {
  const texts = block
    .split('\n')
    // `*` + `/` у тексті (глоби на кшталт `**` + `/*.js`) передчасно закривали б JSDoc —
    // екрануємо backslash-ом, стандартна практика для слешів у doc-коментарях.
    .map(l =>
      l
        .replace(LINE_COMMENT_PREFIX_RE, '')
        .trimEnd()
        .replaceAll('*/', String.raw`*\/`)
    )
  if (texts.length === 1) return `${indent}/** ${texts[0]} */`
  return [`${indent}/**`, ...texts.map(t => `${indent} * ${t}`.trimEnd()), `${indent} */`].join('\n')
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'promote-line-comments-to-jsdoc',
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
        let next = content
        // Дедуплікація (header і export можуть вказувати на той самий блок) +
        // заміна з кінця файлу, щоб офсети попередніх блоків не зсувались.
        const unique = new Map(blocks.map(b => [b.start, b]))
          .values()
          .toArray()
          .toSorted((a, b) => b.start - a.start)
        for (const { start, end } of unique) {
          const lineStart = next.lastIndexOf('\n', start - 1) + 1
          const indent = next.slice(lineStart, start)
          if (indent.trim() !== '') continue // блок не на початку рядка — не чіпаємо
          const block = next.slice(start, end)
          if (block.split('\n').some(l => !LINE_COMMENT_LINE_RE.test(l))) continue // несвіжі офсети
          next = next.slice(0, lineStart) + promoteLineBlock(block, indent) + next.slice(end)
        }
        if (next === content) continue

        ctx.recordWrite?.(absPath)
        await writeFile(absPath, next, 'utf8')
        touchedFiles.push(absPath)
      }

      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `// → JSDoc: ${touchedFiles.length} файл(ів)` }
    }
  }
]
