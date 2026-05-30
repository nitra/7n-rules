/**
 * Обчислення директорії стану `withLock` (lock + dedup), СПІЛЬНОЇ для всіх git-worktree.
 *
 * Лок-стан (`lock/owner.json`, `result.json`) має бути один на головний checkout
 * і всі linked-worktree. Інакше важкі команди (eslint/oxlint/jscpd, conftest,
 * hadolint, per-rule fix), запущені в різних worktree, НЕ серіалізуються —
 * кожен worktree має власний `node_modules/.cache/`, локи одне одного не бачать,
 * і паралельний eslint перевантажує CPU/диск на macOS.
 *
 * `git rev-parse --git-common-dir` повертає той самий `.git` головного репо з
 * будь-якого worktree, тож стан кладемо під `<git-common-dir>/n-cursor/<key>`
 * (всередині `.git` — спільне, ніколи не трекається, переживає `bun i`).
 * Поза git-репо (git недоступний / каталог не репо) — fallback на per-checkout
 * `node_modules/.cache/n-cursor/<key>`, як було історично.
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

/**
 * @param {string} key ключ локу (`lint-ga`, `fix-bun`, …)
 * @param {{cwd?:string, spawn?:typeof import('child_process').spawnSync}} [opts] робоча директорія та sync-виклик git (ін'єкція для тестів)
 * @returns {string} абсолютний шлях до директорії стану локу для цього ключа
 */
export function resolveLockCacheDir(key, opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const spawn = opts.spawn ?? spawnSync

  const r = spawn('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' })
  const commonDir = r.status === 0 && !r.error ? r.stdout.trim() : ''

  if (commonDir === '') {
    return join(cwd, 'node_modules/.cache/n-cursor', key)
  }
  // commonDir буває відносним (`.git` з кореня) або абсолютним (linked-worktree):
  // resolve проти cwd дає однаковий абсолютний `<main>/.git` в обох випадках.
  return join(resolve(cwd, commonDir), 'n-cursor', key)
}
