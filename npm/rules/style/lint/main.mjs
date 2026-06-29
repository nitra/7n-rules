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
 * lint-поверхня: stylelint (per-file для css/scss/vue або весь проєкт у `--full`).
 * @param {string[] | undefined} files per-file: ці файли; undefined: весь проєкт (--full)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {Promise<number>} exit code
 */
export function lint(files, cwd = process.cwd(), opts = {}) {
  const args = opts.readOnly === true ? ['stylelint'] : ['stylelint', '--fix']
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
