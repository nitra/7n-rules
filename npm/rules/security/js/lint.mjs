/**
 * Ci-крок security: trufflehog filesystem скан усього репо (per-file немає).
 */
import { spawnSync } from 'node:child_process'

/**
 * @param {string[] | undefined} _files ігнорується
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd()) {
  const r = spawnSync(
    'trufflehog',
    [
      'filesystem',
      '.',
      '--no-update',
      '--exclude-paths',
      '.trufflehog-exclude',
      '--results=verified,unknown',
      '--fail'
    ],
    { cwd, stdio: 'inherit' }
  )
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}
