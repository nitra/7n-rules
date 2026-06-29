import { spawnSync } from 'node:child_process'

/**
 * lint-поверхня security: trufflehog filesystem скан усього репо.
 * @param {string[] | undefined} _files ігнорується (whole-repo скан)
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} 0 — секретів не знайдено
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
