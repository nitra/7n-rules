/**
 * Quick-крок lint правила js-lint: oxlint + eslint (з автофіксом).
 *
 * Викликається lint-оркестратором (`n-cursor lint` / `lint-ci`):
 *  - `files` = масив змінених файлів (quick) → лінтимо лише js-подібні з них;
 *  - `files` = undefined (ci) → лінтимо весь проєкт.
 * Крос-файлові jscpd/knip — окреме правило js-lint-ci (фаза ci).
 */
import { spawnSync } from 'node:child_process'

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u

/**
 * Лишає лише js-подібні файли зі списку.
 * @param {string[]} files список шляхів
 * @returns {string[]} підмножина js-подібних
 */
export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

/**
 * @param {string[]} args аргументи інструмента (бінар через bunx)
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function run(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: 'inherit' })
  return typeof r.status === 'number' ? r.status : 1
}

/**
 * Запускає oxlint+eslint з автофіксом.
 * @param {string[] | undefined} files quick: лише ці файли; undefined: весь проєкт
 * @param {string} [cwd] корінь репо
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export function lint(files, cwd = process.cwd()) {
  let oxArgs = ['oxlint', '--fix']
  let esArgs = ['eslint', '--fix']
  if (files === undefined) {
    esArgs.push('.')
  } else {
    const js = filterJsFiles(files)
    if (js.length === 0) return Promise.resolve(0)
    oxArgs = ['oxlint', '--fix', ...js]
    esArgs = ['eslint', '--fix', ...js]
  }
  const ox = run(oxArgs, cwd)
  if (ox !== 0) return Promise.resolve(ox)
  return Promise.resolve(run(esArgs, cwd))
}
