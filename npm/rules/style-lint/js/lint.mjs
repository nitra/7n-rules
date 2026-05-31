/**
 * Quick-крок lint правила style-lint: stylelint --fix по css/scss/vue.
 *
 * `files` (quick) → лише style-файли з них; undefined (ci) → весь glob `**\/*.{css,scss,vue}`.
 */
import { spawnSync } from 'node:child_process'

const STYLE_EXT_RE = /\.(?:css|scss|vue)$/u

/**
 * @param {string[]} files список шляхів
 * @returns {string[]} лише css/scss/vue
 */
export function filterStyleFiles(files) {
  return files.filter(f => STYLE_EXT_RE.test(f))
}

/**
 * @param {string[] | undefined} files quick: ці файли; undefined: весь проєкт
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code
 */
export function lint(files, cwd = process.cwd()) {
  const args = ['stylelint', '--fix']
  if (files === undefined) {
    args.push('**/*.{css,scss,vue}')
  } else {
    const style = filterStyleFiles(files)
    if (style.length === 0) return Promise.resolve(0)
    args.push(...style)
  }
  const r = spawnSync('npx', args, { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}
