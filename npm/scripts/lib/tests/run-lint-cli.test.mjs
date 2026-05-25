import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LINT_SCRIPTS, runLintCli } from '../run-lint-cli.mjs'

/**
 * Створює тимчасову теку з package.json, у якому задані scripts.
 *
 * @param {Record<string, string>} scripts
 * @returns {{ root: string, cleanup: () => void }}
 */
function makeProject(scripts) {
  const root = mkdtempSync(join(tmpdir(), 'run-lint-cli-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }), 'utf8')
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/**
 * Фабрика мокованого spawnSync: повертає послідовність exit-кодів і тривалостей.
 *
 * @param {Array<{ status: number, ms: number }>} sequence
 */
function makeSpawnSync(sequence) {
  let i = 0
  /** @type {{ name: string, status: number }[]} */
  const calls = []
  const spawnSyncFn = (_cmd, args) => {
    const item = sequence[i] ?? { status: 0, ms: 0 }
    i++
    calls.push({ name: args[1], status: item.status })
    return { status: item.status, signal: null, output: [], pid: 1, stdout: '', stderr: '' }
  }
  const tickByCallIndex = i_ => sequence.slice(0, i_).reduce((acc, x) => acc + x.ms, 0)
  let nowCalls = 0
  const now = () => {
    // парні виклики (0, 2, 4) — startedAt; непарні — endedAt
    const t = tickByCallIndex(Math.floor(nowCalls / 2)) + (nowCalls % 2 === 0 ? 0 : sequence[Math.floor(nowCalls / 2)]?.ms ?? 0)
    nowCalls++
    return t
  }
  return { spawnSyncFn, now, calls }
}

describe('runLintCli', () => {
  test('LINT_SCRIPTS у фіксованому порядку', () => {
    expect([...LINT_SCRIPTS]).toEqual([
      'lint-ga',
      'lint-js',
      'lint-rego',
      'lint-style',
      'lint-text',
      'lint-security',
      'oxfmt'
    ])
  })

  test('усі присутні скрипти, всі ✅ → exit 0, таблиця по всіх', () => {
    const { root, cleanup } = makeProject({
      'lint-ga': 'echo ga',
      'lint-js': 'echo js',
      'lint-rego': 'echo rego',
      'lint-style': 'echo style',
      'lint-text': 'echo text',
      'lint-security': 'echo security',
      oxfmt: 'echo oxfmt'
    })
    try {
      const { spawnSyncFn, now, calls } = makeSpawnSync([
        { status: 0, ms: 100 },
        { status: 0, ms: 200 },
        { status: 0, ms: 300 },
        { status: 0, ms: 400 },
        { status: 0, ms: 500 },
        { status: 0, ms: 600 },
        { status: 0, ms: 700 }
      ])
      let output = ''
      const code = runLintCli({
        cwd: root,
        spawnSyncFn,
        now,
        log: t => {
          output += t
        }
      })
      expect(code).toBe(0)
      expect(calls.map(c => c.name)).toEqual([...LINT_SCRIPTS])
      expect(output).toContain('⏱  Lint timing:')
      expect(output).toContain('lint-ga')
      expect(output).toContain('oxfmt')
      expect(output).toContain('total')
      expect(output).not.toContain('❌')
    } finally {
      cleanup()
    }
  })

  test('fail-fast: на першому ❌ зупиняється, інші не виконуються', () => {
    const { root, cleanup } = makeProject({
      'lint-ga': 'echo ga',
      'lint-js': 'echo js',
      'lint-rego': 'echo rego'
    })
    try {
      const { spawnSyncFn, now, calls } = makeSpawnSync([
        { status: 0, ms: 100 },
        { status: 2, ms: 800 },
        { status: 0, ms: 999 }
      ])
      let output = ''
      const code = runLintCli({
        cwd: root,
        spawnSyncFn,
        now,
        log: t => {
          output += t
        }
      })
      expect(code).toBe(2)
      expect(calls.map(c => c.name)).toEqual(['lint-ga', 'lint-js'])
      expect(output).toContain('lint-ga')
      expect(output).toContain('lint-js')
      expect(output).not.toContain('lint-rego')
      expect(output).toContain('❌')
    } finally {
      cleanup()
    }
  })

  test('запускає лише ті скрипти, що є у package.json', () => {
    const { root, cleanup } = makeProject({
      'lint-js': 'echo js',
      'lint-style': 'echo style'
    })
    try {
      const { spawnSyncFn, now, calls } = makeSpawnSync([
        { status: 0, ms: 100 },
        { status: 0, ms: 200 }
      ])
      const code = runLintCli({ cwd: root, spawnSyncFn, now, log: () => {} })
      expect(code).toBe(0)
      expect(calls.map(c => c.name)).toEqual(['lint-js', 'lint-style'])
    } finally {
      cleanup()
    }
  })

  test('жодного lint-* у package.json → exit 0 + повідомлення без таблиці', () => {
    const { root, cleanup } = makeProject({ test: 'echo' })
    try {
      let output = ''
      const code = runLintCli({
        cwd: root,
        spawnSyncFn: () => {
          throw new Error('не має викликатись')
        },
        now: () => 0,
        log: t => {
          output += t
        }
      })
      expect(code).toBe(0)
      expect(output).toContain('нічого запускати')
      expect(output).not.toContain('⏱')
    } finally {
      cleanup()
    }
  })

  test('немає package.json → exit 1 + повідомлення у stderr', () => {
    const root = mkdtempSync(join(tmpdir(), 'run-lint-cli-nopkg-'))
    try {
      let errOutput = ''
      const code = runLintCli({
        cwd: root,
        spawnSyncFn: () => {
          throw new Error('не має викликатись')
        },
        now: () => 0,
        log: () => {},
        logError: t => {
          errOutput += t
        }
      })
      expect(code).toBe(1)
      expect(errOutput).toContain('не знайдено package.json')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('некоректний JSON у package.json → exit 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'run-lint-cli-badjson-'))
    writeFileSync(join(root, 'package.json'), '{not json', 'utf8')
    try {
      const code = runLintCli({
        cwd: root,
        spawnSyncFn: () => {
          throw new Error('не має викликатись')
        },
        now: () => 0,
        log: () => {},
        logError: () => {}
      })
      expect(code).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
