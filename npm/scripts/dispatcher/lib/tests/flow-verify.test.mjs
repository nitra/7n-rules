/**
 * Тести `flow verify` handler (`lib/flow-verify.mjs`).
 * FS повністю ін'єктований — без реального диска.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { findLatestOutputs, verify } from '../flow-verify.mjs'

afterEach(() => vi.restoreAllMocks())

const OUTPUTS_CONTENT = `---\ncreated_at: 2026-01-01T00:00:00Z\n---\n## Summary\nDone.\n`
const TASK_CONTENT = `---\ncreated_at: 2026-01-01T00:00:00Z\n---\n## Task\nDo X.\n\n## Done when\nAll tests pass and output exists.\n\n## Inputs\nNone.\n`

/**
 * Будує ін'єкції.
 */
function makeDeps({ files = [], outputs = OUTPUTS_CONTENT, taskContent = TASK_CONTENT } = {}) {
  const fileMap = {}
  if (outputs !== null) fileMap['/node/task/outputs_001.md'] = outputs
  if (taskContent !== null) fileMap['/node/task/task.md'] = taskContent
  return {
    cwd: '/node/task',
    readFile: (p) => {
      if (p in fileMap) return fileMap[p]
      throw new Error(`unexpected readFile: ${p}`)
    },
    readdir: () => files,
    exists: (p) => p in fileMap
  }
}

describe('findLatestOutputs', () => {
  test('порожній список → null', () => {
    expect(findLatestOutputs([])).toBeNull()
  })
  test('один файл → повертає його', () => {
    expect(findLatestOutputs(['outputs_001.md'])).toBe('outputs_001.md')
  })
  test('кілька файлів → найбільший номер', () => {
    expect(findLatestOutputs(['outputs_001.md', 'outputs_003.md', 'outputs_002.md'])).toBe('outputs_003.md')
  })
  test('не outputs файли ігноруються', () => {
    expect(findLatestOutputs(['plan_001.md', 'task.md'])).toBeNull()
  })
})

describe('verify', () => {
  test('відсутній outputs_NNN.md → exit 1', async () => {
    const log = vi.fn()
    const code = await verify([], {
      cwd: '/node/task',
      readdir: () => ['task.md'],
      exists: () => false,
      readFile: () => '',
      log
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('outputs_NNN.md не знайдено'))
  })

  test('outputs порожній (після front-matter) → exit 1', async () => {
    const log = vi.fn()
    const emptyOutputs = '---\ncreated_at: 2026-01-01T00:00:00Z\n---\n   \n'
    const code = await verify([], {
      cwd: '/node/task',
      readdir: () => ['outputs_001.md'],
      exists: (p) => p.endsWith('outputs_001.md'),
      readFile: () => emptyOutputs,
      log
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('порожній'))
  })

  test('валідний outputs → exit 0, stdout містить Done when та outputs', async () => {
    const deps = makeDeps({ files: ['outputs_001.md', 'task.md'] })
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const code = await verify([], deps)
    expect(code).toBe(0)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('Done when')
    expect(printed).toContain('All tests pass')
    expect(printed).toContain('outputs_001.md')
    expect(printed).toContain('Done.')
  })

  test('task.md відсутній → exit 0 (Done when не виводиться, але не блокує)', async () => {
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const code = await verify([], {
      cwd: '/node/task',
      readdir: () => ['outputs_001.md'],
      exists: (p) => p.endsWith('outputs_001.md'),
      readFile: (p) => {
        if (p.endsWith('outputs_001.md')) return OUTPUTS_CONTENT
        throw new Error('no task.md')
      },
      log: vi.fn()
    })
    expect(code).toBe(0)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('outputs_001.md')
  })

  test('вибирає outputs з найбільшим номером', async () => {
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const fileMap = {
      '/node/task/outputs_001.md': '---\ncreated_at: x\n---\n## Summary\nOld.\n',
      '/node/task/outputs_002.md': '---\ncreated_at: x\n---\n## Summary\nNew latest.\n',
      '/node/task/task.md': TASK_CONTENT
    }
    const code = await verify([], {
      cwd: '/node/task',
      readdir: () => ['outputs_001.md', 'outputs_002.md', 'task.md'],
      exists: (p) => p in fileMap,
      readFile: (p) => {
        if (p in fileMap) return fileMap[p]
        throw new Error(`unexpected: ${p}`)
      },
      log: vi.fn()
    })
    expect(code).toBe(0)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('outputs_002.md')
    expect(printed).toContain('New latest')
  })
})
