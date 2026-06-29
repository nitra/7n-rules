import { spawnSync } from 'node:child_process'

/**
 * lint-поверхня js/jscpd_duplicates: bunx jscpd для детекту дублікатів коду.
 * @param {string[] | undefined} _files ігнорується (whole-repo scan)
 * @param {string} [cwd] корінь
 * @returns {Promise<number>}
 */
export function lint(_files, cwd = process.cwd()) {
  const r = spawnSync('bunx', ['jscpd', '.'], { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}
