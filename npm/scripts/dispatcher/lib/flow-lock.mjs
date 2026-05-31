/**
 * Серіалізація мутацій стану `flow` через **reuse** спільного `withLock`
 * (spec §4.1.3). `withLock` уже коректно чистить stale-локи (TTL +
 * `process.kill(pid,0)`) і релізить на SIGINT/SIGTERM — не дублюємо це.
 *
 * **Override для flow:** `onWaitTimeout: 'fail'` — на відміну від lint (де
 * прийнятно «після таймауту запустити без локу»), мутацію стану двома writer-ами
 * не допускаємо → fail-closed. Dedup за fingerprint вимкнено (`getFingerprint:
 * () => null`): flow завжди має виконатись, а не пропуститись за «тим самим
 * деревом».
 *
 * Лок-кеш — sibling `.worktrees/.flow-lock-<branch>/` (поряд зі станом), щоб не
 * залежати від глобального кеш-каталогу.
 */
import { basename, dirname, isAbsolute, join } from 'node:path'

import { withLock } from '../../utils/with-lock.mjs'

/**
 * Виконує `runFn` під per-branch локом flow. Кидає (fail-closed), якщо лок не
 * вдалося взяти за `waitTimeout`.
 * @param {string} worktreeDir абсолютний шлях checkout (`…/.worktrees/feat-x`)
 * @param {() => unknown | Promise<unknown>} runFn критична секція
 * @param {object} [opts] прокидається у `withLock` (напр. `waitTimeout`, `pollInterval`)
 * @returns {Promise<unknown>} результат `runFn`
 */
export function withFlowLock(worktreeDir, runFn, opts = {}) {
  if (!isAbsolute(worktreeDir)) {
    throw new Error(`withFlowLock: очікується абсолютний шлях (отримано: ${worktreeDir})`)
  }
  const base = basename(worktreeDir)
  const cacheDir = join(dirname(worktreeDir), `.flow-lock-${base}`)
  return withLock(`flow-${base}`, runFn, {
    onWaitTimeout: 'fail',
    cacheDir,
    getFingerprint: () => null,
    ...opts
  })
}
