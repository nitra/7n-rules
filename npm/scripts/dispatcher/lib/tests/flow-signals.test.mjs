/**
 * Тести сигнальних handlers `flow done/audit/failed/spawn`
 * (`lib/flow-signals.mjs`). Процес-spawning і FS ін'єктовані.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { audit, done, failed, resolveNodePath, spawn } from '../flow-signals.mjs'

afterEach(() => vi.restoreAllMocks())

/** Мок run, що повертає success */
const runOk = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
/** Мок run, що повертає failure */
const runFail = vi.fn(() => ({ status: 1, stdout: '', stderr: 'err' }))

/** Базові deps без env var і без файлу fallback */
const noNodePath = {
  env: {},
  exists: () => false,
  readFile: () => { throw new Error('no file') }
}

describe('resolveNodePath', () => {
  test('NCURSOR_NODE_PATH встановлено → повертає його', () => {
    const r = resolveNodePath({
      env: { NCURSOR_NODE_PATH: '/tasks/my-task' },
      cwd: '/wt',
      exists: () => false,
      readFile: () => ''
    })
    expect(r.nodePath).toBe('/tasks/my-task')
    expect(r.error).toBeNull()
  })

  test('NCURSOR_NODE_PATH порожній → fallback до файлу', () => {
    const r = resolveNodePath({
      env: { NCURSOR_NODE_PATH: '  ' },
      cwd: '/wt',
      exists: (p) => p === '/wt/.n-cursor/current-node',
      readFile: () => '/tasks/from-file'
    })
    expect(r.nodePath).toBe('/tasks/from-file')
  })

  test('env відсутній, fallback-файл є → повертає вміст файлу', () => {
    const r = resolveNodePath({
      env: {},
      cwd: '/wt',
      exists: (p) => p === '/wt/.n-cursor/current-node',
      readFile: () => '/tasks/my-task\n'
    })
    expect(r.nodePath).toBe('/tasks/my-task')
  })

  test('нічого немає → error', () => {
    const r = resolveNodePath({
      env: {},
      cwd: '/wt',
      exists: () => false,
      readFile: () => ''
    })
    expect(r.nodePath).toBeNull()
    expect(r.error).toContain('NCURSOR_NODE_PATH not set')
  })
})

describe('done', () => {
  test('node path відсутній → exit 1', async () => {
    const log = vi.fn()
    const code = await done([], { ...noNodePath, log, run: runOk })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('NCURSOR_NODE_PATH not set'))
  })

  test('делегує graph done → exit 0', async () => {
    const run = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    const code = await done([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: () => false,
      readFile: () => '',
      log: vi.fn(),
      run
    })
    expect(code).toBe(0)
    expect(run).toHaveBeenCalledWith('npx', ['@nitra/cursor', 'graph', 'done', '/tasks/x'])
  })

  test('graph done повертає помилку → exit 1', async () => {
    const log = vi.fn()
    const code = await done([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: () => false,
      readFile: () => '',
      log,
      run: () => ({ status: 1, stdout: '', stderr: 'fail' })
    })
    expect(code).toBe(1)
  })
})

describe('failed', () => {
  test('делегує graph failed', async () => {
    const run = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    const code = await failed([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: () => false,
      readFile: () => '',
      log: vi.fn(),
      run
    })
    expect(code).toBe(0)
    expect(run).toHaveBeenCalledWith('npx', ['@nitra/cursor', 'graph', 'failed', '/tasks/x'])
  })
})

describe('spawn', () => {
  test('делегує graph spawn', async () => {
    const run = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    const code = await spawn([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: () => false,
      readFile: () => '',
      log: vi.fn(),
      run
    })
    expect(code).toBe(0)
    expect(run).toHaveBeenCalledWith('npx', ['@nitra/cursor', 'graph', 'spawn', '/tasks/x'])
  })
})

describe('audit', () => {
  test('відсутній outputs_NNN.md → exit 1', async () => {
    const log = vi.fn()
    const code = await audit([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: (p) => !p.includes('outputs'),
      readFile: () => '',
      readdir: () => ['task.md'],
      writeFile: () => {},
      log,
      run: runOk
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('outputs_NNN.md не знайдено'))
  })

  test('happy path: створює pending-audit_001.md і делегує graph audit', async () => {
    const written = {}
    const existingFiles = ['outputs_001.md', 'task.md']
    const existingPaths = new Set(['/wt/outputs_001.md', '/wt/task.md'])
    const run = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    const code = await audit([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: (p) => existingPaths.has(p),
      readFile: () => '',
      readdir: () => existingFiles,
      writeFile: (p, content) => { written[p] = content },
      now: () => '2026-06-07T10:00:00.000Z',
      log: vi.fn(),
      run
    })
    expect(code).toBe(0)
    expect(written['/wt/pending-audit_001.md']).toContain('outputs_ref: outputs_001.md')
    expect(written['/wt/pending-audit_001.md']).toContain('actor: agent')
    expect(run).toHaveBeenCalledWith('npx', ['@nitra/cursor', 'graph', 'audit', '/tasks/x'])
  })

  test('pending-audit вже існує → exit 1', async () => {
    const log = vi.fn()
    const code = await audit([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: (p) => p.endsWith('outputs_001.md') || p.endsWith('pending-audit_001.md'),
      readFile: () => '',
      readdir: () => ['outputs_001.md', 'pending-audit_001.md'],
      writeFile: () => {},
      log,
      run: runOk
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('вже існує'))
  })

  test('NNN у pending-audit збігається з NNN outputs', async () => {
    const written = {}
    const run = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    await audit([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: (p) => p.endsWith('outputs_003.md'),
      readFile: () => '',
      readdir: () => ['outputs_001.md', 'outputs_003.md', 'outputs_002.md'],
      writeFile: (p, content) => { written[p] = content },
      now: () => '2026-06-07T10:00:00.000Z',
      log: vi.fn(),
      run
    })
    expect(Object.keys(written)).toContain('/wt/pending-audit_003.md')
  })

  test('помилка запису файлу → exit 1', async () => {
    const log = vi.fn()
    const code = await audit([], {
      env: { NCURSOR_NODE_PATH: '/tasks/x' },
      cwd: '/wt',
      exists: (p) => p.endsWith('outputs_001.md'),
      readFile: () => '',
      readdir: () => ['outputs_001.md'],
      writeFile: () => { throw new Error('write error') },
      log,
      run: runOk
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('write error'))
  })
})
