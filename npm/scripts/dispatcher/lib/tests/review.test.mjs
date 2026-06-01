/**
 * Тести `flow review` (`lib/review.mjs`). git(`run`)/`runner`/`now` ін'єктуються —
 * без реальних git/LLM.
 */
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { diffFromBase, parseFindings, dedupeFindings, review, reviewerPrompt } from '../review.mjs'
import { flowStatePath, readState, writeState } from '../state-store.mjs'

const noop = () => {}
const FIXED = () => 1_700_000_000_000

/**
 * Фейковий git-runner: `committed` для діапазонного diff (`base...HEAD`),
 * `working` — для `git diff` робочого дерева.
 * @param {string} committed stdout діапазонного diff
 * @param {string} working stdout diff робочого дерева
 * @returns {(cmd: string, args: string[]) => { stdout: string }} runner
 */
function fakeGit(committed, working) {
  return (_cmd, args) => ({ stdout: args.some(a => a.includes('...')) ? committed : working })
}

describe('diffFromBase', () => {
  test('склеює committed + working diff', () => {
    expect(diffFromBase('BASE', fakeGit('C', 'W'), '/wt')).toBe('C\nW')
  })
  test('порожні diff → порожній рядок', () => {
    expect(diffFromBase('BASE', fakeGit('', ''), '/wt')).toBe('')
  })
})

describe('parseFindings', () => {
  test('валідний JSON → масив', () => {
    expect(parseFindings('[{"severity":"high","issue":"x"}]')).toEqual([{ severity: 'high', issue: 'x' }])
  })
  test('сміття → [] (fail-soft)', () => {
    expect(parseFindings('нема json')).toEqual([])
    expect(parseFindings('[бите')).toEqual([])
  })
})

describe('reviewerPrompt', () => {
  test('high-risk додає безпекову лінзу', () => {
    expect(reviewerPrompt('diff', 'high')).toMatch(/БЕЗПЕЦ/)
  })
  test('low-risk — без лінзи', () => {
    expect(reviewerPrompt('diff', 'low')).not.toMatch(/БЕЗПЕЦ/)
  })
})

describe('dedupeFindings', () => {
  test('дедуп за file+issue', () => {
    const f = [{ file: 'a', issue: 'x' }, { file: 'a', issue: 'x' }, { file: 'b', issue: 'x' }]
    expect(dedupeFindings(f)).toHaveLength(2)
  })
})

describe('review', () => {
  test('без стану → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      expect(await review([], { cwd: wt, log: noop, run: () => ({ stdout: '' }) })).toBe(1)
    })
  })

  test('порожній diff → код 0, без review у стані', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress', level: 1 })
      const code = await review([], { cwd: wt, log: noop, run: () => ({ stdout: '' }), now: FIXED })
      expect(code).toBe(0)
      expect(readState(flowStatePath(wt)).review).toBeUndefined()
    })
  })

  test('findings пишуться у стан; код 0; кількість рецензентів за level', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress', level: 3, metadata: { base_commit: 'B' } })
      const runner = { runStep: async () => ({ ok: true, output: '[{"severity":"high","file":"a.mjs","issue":"bug"}]' }) }
      const code = await review([], { cwd: wt, log: noop, run: () => ({ stdout: 'diff' }), runner, now: FIXED })
      expect(code).toBe(0)
      const s = readState(flowStatePath(wt))
      expect(s.review.reviewers).toBe(3) // level 3 → 3 рецензенти
      expect(s.review.findings).toHaveLength(1) // дедуп ідентичних
      expect(s.review.findings[0].severity).toBe('high')
    })
  })

  test('low level + high risk → 3 рецензенти (ризик переважує розмір)', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-r')
      writeState(flowStatePath(wt), { branch: 'feat/r', status: 'in_progress', level: 0, risk: 'high', metadata: { base_commit: 'B' } })
      const runner = { runStep: async () => ({ ok: true, output: '[]' }) }
      await review([], { cwd: wt, log: noop, run: () => ({ stdout: 'diff' }), runner, now: FIXED })
      expect(readState(flowStatePath(wt)).review.reviewers).toBe(3)
    })
  })
})
