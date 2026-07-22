/**
 * ESTree-парсинг через `oxc-parser` — заміна `rollup/parseAst` після влиття
 * `@7n/test` (spec 2026-07-22): той самий ESTree-shape (`type`, числові
 * `start`/`end`, `Literal.raw`, `UnaryExpression.prefix` — звірено на
 * oxc-parser 0.137), але без rollup у залежностях. Відмінність від rollup:
 * oxc не кидає на синтакс-помилці, а повертає `errors[]` — адаптер відновлює
 * throw-контракт, на який розраховують споживачі (mutation-валідація).
 */
import { parseSync } from 'oxc-parser'

/**
 * Парсить ESM-джерело в ESTree-програму.
 * @param {string} code джерело модуля
 * @param {string} [filename] імʼя файлу (визначає діалект: .mjs/.ts/.tsx)
 * @returns {object} ESTree Program (вузли зі `start`/`end`)
 * @throws {Error} на синтакс-помилці (перша з `errors[]`)
 */
export function parseAst(code, filename = 'module.mjs') {
  const result = parseSync(filename, code)
  if (result.errors?.length > 0) {
    throw new Error(`parse error: ${result.errors[0]?.message ?? String(result.errors[0])}`)
  }
  return result.program
}
