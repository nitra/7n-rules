/**
 * Тести handler-а `flow plan` (`lib/plan.mjs`). FS — на тимчасовому каталозі;
 * `trace`/`runner` ін'єктуються (без реального trace/субагентів).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { plan } from '../plan.mjs'
import { flowStatePath, readState, writeState } from '../state-store.mjs'

const noop = () => {}
const okTrace = () => 0

/**
 * Готує worktree зі станом і (опц.) plan-doc.
 * @param {string} dir tmp-корінь
 * @param {string} branch гілка
 * @param {string | null} planBody вміст docs/plans/*.md або null
 * @returns {{ wt: string, doc: string }} шляхи
 */
function setup(dir, branch, planBody) {
  const wt = join(dir, '.worktrees', branch)
  mkdirSync(join(wt, 'docs', 'plans'), { recursive: true })
  writeState(flowStatePath(wt), { branch: `feat/${branch}`, status: 'spec', spec_doc: 'docs/specs/x.md' })
  const doc = join(wt, 'docs', 'plans', `2026-06-01-${branch}.md`)
  if (planBody !== null) writeFileSync(doc, planBody)
  return { wt, doc }
}

describe('plan', () => {
  test('без стану → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      mkdirSync(wt, { recursive: true })
      expect(await plan([], { cwd: wt, log: noop, trace: okTrace })).toBe(1)
    })
  })

  test('нема plan-doc → 1', async () => {
    await withTmpDir(async dir => {
      const { wt } = setup(dir, 'feat-y', null)
      expect(await plan([], { cwd: wt, log: noop, trace: okTrace })).toBe(1)
    })
  })

  test('валідний plan-doc → status planned, plan[] + plan_doc', async () => {
    await withTmpDir(async dir => {
      const { wt, doc } = setup(
        dir,
        'feat-x',
        '# П\n## Кроки\n1. Зробити A — acceptance: A працює\n2. Зробити B — acceptance: B\n'
      )
      const code = await plan([], { cwd: wt, log: noop, trace: okTrace })
      expect(code).toBe(0)
      const s = readState(flowStatePath(wt))
      expect(s.status).toBe('planned')
      expect(s.plan_doc).toBe(doc)
      expect(s.plan).toHaveLength(2)
      expect(s.plan[0]).toMatchObject({ step: 0, task: 'Зробити A', acceptance: 'A працює', status: 'pending' })
    })
  })

  test('placeholder-крок у doc → 1 (через parsePlan)', async () => {
    await withTmpDir(async dir => {
      const { wt } = setup(dir, 'feat-tbd', '## Кроки\n1. TBD\n')
      expect(await plan([], { cwd: wt, log: noop, trace: okTrace })).toBe(1)
    })
  })

  test('розрив trace → попередження, код 0', async () => {
    await withTmpDir(async dir => {
      const { wt } = setup(dir, 'feat-z', '## Кроки\n1. A — acceptance: ok\n')
      const msgs = []
      const code = await plan([], { cwd: wt, log: m => msgs.push(m), trace: () => 1 })
      expect(code).toBe(0)
      expect(msgs.join('\n')).toMatch(/розрив/i)
    })
  })

  test('--panel: суддя синтезує кроки → planned', async () => {
    await withTmpDir(async dir => {
      const { wt } = setup(dir, 'feat-panel', null)
      const runner = { runStep: async () => ({ ok: true, output: '[{"task":"Крок","acceptance":"ok"}]' }) }
      const code = await plan(['--panel'], { cwd: wt, runner, log: noop, trace: okTrace })
      expect(code).toBe(0)
      expect(readState(flowStatePath(wt)).plan[0].task).toBe('Крок')
    })
  })
})
