/**
 * Тести `flow plan` handler (`lib/flow-plan.mjs`).
 * FS повністю ін'єктований — без реального диска.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { buildPlanTemplate, plan } from '../flow-plan.mjs'

afterEach(() => vi.restoreAllMocks())

/** Мінімальна task.md без front-matter */
const TASK_NO_FM = `## Task\nRealize feature X.\n\n## Done when\nTests pass.`

/** task.md з mode: agent і hint: atomic */
const TASK_AGENT = `---\ncreated_at: 2026-01-01T00:00:00Z\nmode: agent\nhint: atomic\n---\n\n## Task\nDo something.\n\n## Done when\nAll green.`

/** task.md з mode: human (explicit) */
const TASK_HUMAN = `---\ncreated_at: 2026-01-01T00:00:00Z\nmode: human\n---\n\n## Task\nDo something.\n\n## Done when\nAll green.`

/**
 * Будує ін'єкції з заданим вмістом task.md і списком файлів директорії.
 */
function makeDeps(taskContent, existingFiles = []) {
  const written = {}
  return {
    cwd: '/node/task-x',
    readFile: (p) => {
      if (p.endsWith('task.md')) return taskContent
      throw new Error(`unexpected readFile: ${p}`)
    },
    writeFile: (p, content) => {
      written[p] = content
    },
    readdir: () => existingFiles,
    exists: (p) => p.endsWith('task.md'),
    now: () => '2026-06-07T10:00:00.000Z',
    _written: written
  }
}

describe('buildPlanTemplate', () => {
  test('містить created_at, mode, decision, секції Context/Approach/Risks', () => {
    const t = buildPlanTemplate({ mode: 'human', hint: 'atomic', now: '2026-01-01T00:00:00Z' })
    expect(t).toContain('created_at: 2026-01-01T00:00:00Z')
    expect(t).toContain('mode: human')
    expect(t).toContain('decision: atomic')
    expect(t).toContain('## Context')
    expect(t).toContain('## Approach')
    expect(t).toContain('## Risks')
  })

  test('без hint — decision містить плейсхолдер', () => {
    const t = buildPlanTemplate({ mode: 'agent', hint: '', now: '2026-01-01T00:00:00Z' })
    expect(t).toContain('decision: atomic | composite')
  })
})

describe('plan', () => {
  test('task.md відсутній → exit 1', async () => {
    const log = vi.fn()
    const code = await plan([], {
      cwd: '/some/path',
      exists: () => false,
      log,
      readFile: () => '',
      readdir: () => [],
      writeFile: () => {}
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('task.md не знайдено'))
  })

  test('без front-matter → mode=human, hint порожній, plan_001.md', async () => {
    const deps = makeDeps(TASK_NO_FM)
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    const code = await plan([], deps)
    expect(code).toBe(0)
    const planPath = '/node/task-x/plan_001.md'
    expect(deps._written[planPath]).toBeDefined()
    expect(deps._written[planPath]).toContain('mode: human')
    expect(logOut.mock.calls.join('\n')).toContain('mode: human')
  })

  test('mode: agent, hint: atomic → plan_001.md з відповідними полями', async () => {
    const deps = makeDeps(TASK_AGENT)
    vi.spyOn(console, 'log').mockReturnValue()
    const code = await plan([], deps)
    expect(code).toBe(0)
    const planPath = '/node/task-x/plan_001.md'
    expect(deps._written[planPath]).toContain('mode: agent')
    expect(deps._written[planPath]).toContain('decision: atomic')
  })

  test('нумерація: є plan_001.md і plan_002.md → створює plan_003.md', async () => {
    const deps = makeDeps(TASK_HUMAN, ['plan_001.md', 'plan_002.md', 'task.md'])
    vi.spyOn(console, 'log').mockReturnValue()
    const code = await plan([], deps)
    expect(code).toBe(0)
    expect(Object.keys(deps._written)).toContain('/node/task-x/plan_003.md')
  })

  test('помилка запису → exit 1', async () => {
    const log = vi.fn()
    const code = await plan([], {
      cwd: '/node/task-x',
      exists: (p) => p.endsWith('task.md'),
      readFile: () => TASK_NO_FM,
      readdir: () => [],
      writeFile: () => { throw new Error('disk full') },
      log,
      now: () => '2026-01-01T00:00:00Z'
    })
    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  })

  test('stdout містить task body і mode рядок', async () => {
    const deps = makeDeps(TASK_AGENT)
    const logOut = vi.spyOn(console, 'log').mockReturnValue()
    await plan([], deps)
    const printed = logOut.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('mode: agent')
    expect(printed).toContain('Do something')
  })
})
