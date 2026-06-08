/**
 * Тести `flow verify` handler (`graph/lib/cmd-verify.mjs`).
 * FS повністю ін'єктований — без реального диска.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { cmdVerify } from '../cmd-verify.mjs'

afterEach(() => vi.restoreAllMocks())

const FACT_CONTENT = `---\ncreated_at: 2026-01-01T00:00:00Z\n---\n## Summary\nDone.\n`
const TASK_CONTENT = `---\ncreated_at: 2026-01-01T00:00:00Z\n---\n## Task\nDo X.\n\n## Done when\nAll tests pass and output exists.\n\n## Inputs\nNone.\n`

/**
 * Будує ін'єкції.
 * @param {{ files?: string[], fact?: string|null, taskContent?: string|null }} [params]
 * @returns {object} набір ін'єкцій для cmdVerify()
 */
function makeDeps({ files = [], fact = FACT_CONTENT, taskContent = TASK_CONTENT } = {}) {
  const fileMap = {}
  if (fact !== null) fileMap['/node/task/fact_001.md'] = fact
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

describe('cmdVerify', () => {
  test('відсутній fact_NNN.md → exit 1', async () => {
    const log = vi.fn()
    const code = await cmdVerify([], {
      cwd: '/node/task',
      readdir: () => ['task.md'],
      exists: () => false,
      readFile: () => '',
      log
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('fact_NNN.md не знайдено'))
  })

  test('fact порожній (після front-matter) → exit 1', async () => {
    const log = vi.fn()
    const emptyFact = '---\ncreated_at: 2026-01-01T00:00:00Z\n---\n   \n'
    const code = await cmdVerify([], {
      cwd: '/node/task',
      readdir: () => ['fact_001.md'],
      exists: (p) => p.endsWith('fact_001.md'),
      readFile: () => emptyFact,
      log
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('порожній'))
  })

  test('валідний fact → exit 0, stdout містить Done when та fact', async () => {
    const deps = makeDeps({ files: ['fact_001.md', 'task.md'] })
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const code = await cmdVerify([], deps)
    expect(code).toBe(0)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('Done when')
    expect(printed).toContain('All tests pass')
    expect(printed).toContain('fact_001.md')
    expect(printed).toContain('Done.')
  })

  test('task.md відсутній → exit 0 (Done when не виводиться, але не блокує)', async () => {
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const code = await cmdVerify([], {
      cwd: '/node/task',
      readdir: () => ['fact_001.md'],
      exists: (p) => p.endsWith('fact_001.md'),
      readFile: (p) => {
        if (p.endsWith('fact_001.md')) return FACT_CONTENT
        throw new Error('no task.md')
      },
      log: vi.fn()
    })
    expect(code).toBe(0)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('fact_001.md')
  })

  test('вибирає fact з найбільшим номером', async () => {
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const fileMap = {
      '/node/task/fact_001.md': '---\ncreated_at: x\n---\n## Summary\nOld.\n',
      '/node/task/fact_002.md': '---\ncreated_at: x\n---\n## Summary\nNew latest.\n',
      '/node/task/task.md': TASK_CONTENT
    }
    const code = await cmdVerify([], {
      cwd: '/node/task',
      readdir: () => ['fact_001.md', 'fact_002.md', 'task.md'],
      exists: (p) => p in fileMap,
      readFile: (p) => {
        if (p in fileMap) return fileMap[p]
        throw new Error(`unexpected: ${p}`)
      },
      log: vi.fn()
    })
    expect(code).toBe(0)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('fact_002.md')
    expect(printed).toContain('New latest')
  })
})
