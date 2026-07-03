import * as fs from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { createProgressPublisher, lintLockFingerprint, renderWaitLine, withGlobalLintLock } from '../lint-lock.mjs'

const TREE_FP = 'a'.repeat(64)
const RE_SHA256_HEX = /^[0-9a-f]{64}$/u
const RE_LOCK_TIMEOUT = /не вдалося взяти лок/u

/**
 * Варіант виклику lint для тестів — за замовчуванням full (шлях із локом),
 * cwd збігається з процесним (дедуплікація можлива).
 * @param {Partial<{cwd: string, full: boolean, rules: string[], noFix: boolean}>} [overrides] відхилення від бази
 * @returns {{cwd: string, full: boolean, rules: string[], noFix: boolean}} варіант
 */
function makeVariant(overrides = {}) {
  return { cwd: processCwd(), full: true, rules: [], noFix: false, ...overrides }
}

/**
 * Створює зайнятий лок від «живого чужого» власника (host інший → PID-перевірка
 * не спрацює, startedAt свіжий → не stale): чекати доведеться по-справжньому.
 * @param {string} cacheDir директорія стану лока
 * @param {object} [extra] додаткові поля owner.json
 * @returns {void}
 */
function holdLockByForeignOwner(cacheDir, extra = {}) {
  const lockDir = join(cacheDir, 'lock')
  fs.mkdirSync(lockDir, { recursive: true })
  fs.writeFileSync(
    join(lockDir, 'owner.json'),
    JSON.stringify({ pid: process.pid, host: 'other-host', startedAt: Date.now(), fingerprint: null, ...extra })
  )
}

describe('lintLockFingerprint — дедуп-ключ: дерево + варіант виклику (spec 2026-07-03)', () => {
  test('null при --cwd не на процесний cwd: знімок дерева відповідав би не тому дереву', () => {
    expect(lintLockFingerprint(makeVariant({ cwd: '/somewhere/else' }), () => TREE_FP)).toBeNull()
  })

  test('null поза git-репо (tree-fingerprint null)', () => {
    expect(lintLockFingerprint(makeVariant(), () => null)).toBeNull()
  })

  test('той самий варіант на тому самому дереві → стабільний fingerprint', () => {
    const a = lintLockFingerprint(makeVariant(), () => TREE_FP)
    const b = lintLockFingerprint(makeVariant(), () => TREE_FP)
    expect(a).toMatch(RE_SHA256_HEX)
    expect(a).toBe(b)
  })

  test('порядок rules не впливає: lint js text ≡ lint text js', () => {
    const a = lintLockFingerprint(makeVariant({ rules: ['js', 'text'] }), () => TREE_FP)
    const b = lintLockFingerprint(makeVariant({ rules: ['text', 'js'] }), () => TREE_FP)
    expect(a).toBe(b)
  })

  test('інший варіант (--no-fix, rules) → інший fingerprint: scoped-успіх не маскує ширший прогін', () => {
    const base = lintLockFingerprint(makeVariant(), () => TREE_FP)
    expect(lintLockFingerprint(makeVariant({ noFix: true }), () => TREE_FP)).not.toBe(base)
    expect(lintLockFingerprint(makeVariant({ rules: ['js'] }), () => TREE_FP)).not.toBe(base)
  })

  test('інше дерево → інший fingerprint', () => {
    const a = lintLockFingerprint(makeVariant(), () => TREE_FP)
    const b = lintLockFingerprint(makeVariant(), () => 'b'.repeat(64))
    expect(a).not.toBe(b)
  })
})

describe('withGlobalLintLock — лок лише для --full (spec 2026-07-03, ревізія)', () => {
  test('не-full варіант виконується одразу, без лока: cacheDir не створюється', async () => {
    await withTmpDir(async dir => {
      const cacheDir = join(dir, 'lock-state')
      const code = await withGlobalLintLock(makeVariant({ full: false }), () => 5, { cacheDir })
      expect(code).toBe(5)
      expect(fs.existsSync(cacheDir)).toBe(false)
    })
  })

  test('не-full варіант не чекає навіть коли лок зайнятий чужим full-прогоном', async () => {
    await withTmpDir(async dir => {
      const cacheDir = join(dir, 'lock-state')
      holdLockByForeignOwner(cacheDir)
      const code = await withGlobalLintLock(makeVariant({ full: false }), () => 0, {
        cacheDir,
        waitTimeout: 1,
        getFingerprint: () => null
      })
      expect(code).toBe(0)
    })
  })

  test('послідовні full-запуски виконуються, лок звільняється', async () => {
    await withTmpDir(async dir => {
      const opts = { cacheDir: join(dir, 'lock-state'), getFingerprint: () => null }
      expect(await withGlobalLintLock(makeVariant(), () => 0, opts)).toBe(0)
      expect(await withGlobalLintLock(makeVariant(), () => 42, opts)).toBe(42)
    })
  })

  test('full за живим чужим локом: чекає (рядок черги з позицією і власником), далі fail-closed', async () => {
    await withTmpDir(async dir => {
      const cacheDir = join(dir, 'lock-state')
      holdLockByForeignOwner(cacheDir, { cwd: '/some/repo' })
      /** @type {string[]} */
      const lines = []
      let ran = false
      await expect(
        withGlobalLintLock(
          makeVariant(),
          () => {
            ran = true
            return 0
          },
          {
            cacheDir,
            waitTimeout: 60,
            pollInterval: 10,
            getFingerprint: () => null,
            isTTY: false,
            log: s => {
              lines.push(s)
            },
            queueDir: join(dir, 'queue'),
            progressFile: join(dir, 'progress.json')
          }
        )
      ).rejects.toThrow(RE_LOCK_TIMEOUT)
      expect(ran).toBe(false)
      const joined = lines.join('')
      expect(joined).toContain('lint --full у черзі #1/1')
      expect(joined).toContain(`працює pid ${process.pid} (repo)`)
    })
  })

  test('full-лок мертвого PID на цьому host перехоплюється одразу', async () => {
    await withTmpDir(async dir => {
      const cacheDir = join(dir, 'lock-state')
      const lockDir = join(cacheDir, 'lock')
      fs.mkdirSync(lockDir, { recursive: true })
      fs.writeFileSync(
        join(lockDir, 'owner.json'),
        JSON.stringify({ pid: 999_999_999, host: hostname(), startedAt: Date.now(), fingerprint: null })
      )
      const code = await withGlobalLintLock(makeVariant(), () => 7, {
        cacheDir,
        getFingerprint: () => null
      })
      expect(code).toBe(7)
    })
  })
})

describe('createProgressPublisher — стан-файл прогресу для черги', () => {
  test('пише знімок із pid/updatedAt, throttle приглушує щільні оновлення, stop прибирає файл', async () => {
    await withTmpDir(dir => {
      const file = join(dir, 'progress.json')
      const publisher = createProgressPublisher({ file, minIntervalMs: 60_000 })
      publisher.onUpdate({ done: 3, total: 12, found: 5, fixed: 1, current: 'js/eslint' })
      const snap = JSON.parse(fs.readFileSync(file, 'utf8'))
      expect(snap).toMatchObject({ pid: process.pid, done: 3, total: 12, found: 5, fixed: 1, current: 'js/eslint' })
      expect(snap.updatedAt).toBeGreaterThan(0)

      // другий update у межах minIntervalMs — файл не перезаписується
      publisher.onUpdate({ done: 4, total: 12, found: 6, fixed: 2, current: 'text/oxfmt' })
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).done).toBe(3)

      publisher.stop()
      expect(fs.existsSync(file)).toBe(false)
    })
  })
})

describe('renderWaitLine — рядок черги', () => {
  test('містить позицію, власника з текою, бар власника і решту черги', () => {
    const owner = { pid: 111, cwd: '/repos/cursor' }
    const queue = [
      { pid: 222, cwd: '/repos/other', enqueuedAt: 1 },
      { pid: process.pid, cwd: processCwd(), enqueuedAt: 2 }
    ]
    const snap = { done: 5, total: 12, found: 47, fixed: 32, current: 'js/eslint' }
    const line = renderWaitLine(owner, queue, snap)
    expect(line).toContain('у черзі #2/2')
    expect(line).toContain('працює pid 111 (cursor)')
    expect(line).toContain('5/12 концернів · знайдено 47 · виправлено 32 · js/eslint')
    expect(line).toContain('чекають: pid 222 (other)')
  })

  test('без знімка прогресу бар відсутній, рядок валідний', () => {
    const line = renderWaitLine({ pid: 111 }, [], null)
    expect(line).toContain('у черзі #1/1')
    expect(line).toContain('працює pid 111')
    expect(line).not.toContain('[')
  })
})
