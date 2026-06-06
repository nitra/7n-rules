/** @see ./docs/lint.md */
import { spawnSync } from 'node:child_process'

/**
 * @param {string[] | undefined} _files ігнорується (крос-файловий аналіз)
 * @param {string} [cwd] корінь репо
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export function lint(_files, cwd = process.cwd()) {
  const jscpd = spawnSync('bunx', ['jscpd', '.'], { cwd, stdio: 'inherit' })
  const jc = typeof jscpd.status === 'number' ? jscpd.status : 1
  if (jc !== 0) return Promise.resolve(jc)
  const knip = spawnSync('bunx', ['knip', '--no-config-hints'], { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof knip.status === 'number' ? knip.status : 1)
}
