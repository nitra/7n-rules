/**
 * Тести git-reconcile: парсинг Git inventory, bounded LLM contract і
 * orchestration без реальних worktree/push/PR.
 */
import { describe, expect, test } from 'vitest'

import {
  branchSlug,
  buildTriagePrompt,
  callRunner,
  conflictFiles,
  dedupeRefs,
  formatReport,
  parseDecisionEnvelope,
  parseWorktrees,
  runGitReconcileOrchestrator
} from '../orchestrate.mjs'

const REVIEW_BRANCH = {
  source: 'branch:refs/remotes/origin/feature/a',
  ref: 'refs/remotes/origin/feature/a',
  name: 'feature/a',
  state: 'review',
  commits: [{ oid: 'abc123', subject: 'fix: useful' }],
  changedFiles: ['M\tsrc/a.mjs'],
  conflicts: []
}

function inventory(overrides = {}) {
  return {
    base: 'origin/main',
    branches: [
      REVIEW_BRANCH,
      {
        source: 'branch:refs/remotes/origin/already-merged',
        name: 'already-merged',
        state: 'merged',
        commits: []
      }
    ],
    stashes: [
      {
        source: 'stash:stash@{0}',
        ref: 'stash@{0}',
        subject: 'WIP',
        state: 'review',
        changedFiles: ['M\tsrc/wip.mjs']
      }
    ],
    warnings: [],
    ...overrides
  }
}

describe('Git inventory helpers', () => {
  test('parseWorktrees повертає branch ref → checkout path', () => {
    const parsed = parseWorktrees(
      [
        'worktree /repo',
        'HEAD abc',
        'branch refs/heads/main',
        '',
        'worktree /repo/.worktrees/feature-a',
        'HEAD def',
        'branch refs/heads/feature/a',
        ''
      ].join('\n')
    )

    expect([...parsed]).toEqual([
      ['refs/heads/main', '/repo'],
      ['refs/heads/feature/a', '/repo/.worktrees/feature-a']
    ])
  })

  test('dedupeRefs лишає remote ref і переносить protection локального worktree', () => {
    const worktrees = new Map([['refs/heads/feature/a', '/repo/.worktrees/feature-a']])
    const refs = dedupeRefs(
      [
        { ref: 'refs/heads/feature/a', oid: 'abc', date: '2026-01-01' },
        { ref: 'refs/remotes/origin/feature/a', oid: 'abc', date: '2026-01-02' },
        { ref: 'refs/remotes/origin/HEAD', oid: 'main', date: '2026-01-03' },
        { ref: 'refs/heads/main', oid: 'main', date: '2026-01-03' }
      ],
      worktrees
    )

    expect(refs).toEqual([
      {
        ref: 'refs/remotes/origin/feature/a',
        oid: 'abc',
        date: '2026-01-02',
        worktree: '/repo/.worktrees/feature-a'
      }
    ])
  })

  test('conflictFiles витягає й дедуплікує шляхи merge-tree', () => {
    expect(
      conflictFiles(
        [
          'CONFLICT (content): Merge conflict in src/a.mjs',
          'CONFLICT (rename/delete): src/b.mjs renamed to src/c.mjs in x, but deleted in y.',
          'CONFLICT (modify/delete): src/d.mjs deleted in main and modified in feature.',
          'CONFLICT (content): Merge conflict in src/a.mjs'
        ].join('\n')
      )
    ).toEqual(['src/a.mjs', 'src/c.mjs', 'src/d.mjs'])
  })
})

describe('LLM boundary', () => {
  test('triage prompt забороняє Git-дії моделі й містить лише підготовлені facts', () => {
    const prompt = buildTriagePrompt([REVIEW_BRANCH], 'збережи завершені fixes')

    expect(prompt).toContain('Не запускай команди')
    expect(prompt).toContain('лише JSON')
    expect(prompt).toContain('збережи завершені fixes')
    expect(prompt).toContain(REVIEW_BRANCH.source)
  })

  test('parseDecisionEnvelope приймає fenced JSON, відхиляє сміття', () => {
    expect(parseDecisionEnvelope('```json\n{"decisions":[]}\n```')).toEqual({ decisions: [] })
    expect(parseDecisionEnvelope('no json')).toBeNull()
  })

  test('callRunner pi використовує git-reconcile/max і збирає streaming text', async () => {
    const calls = []
    const result = await callRunner('pi', 'triage', '/repo', {
      runAgentSkill: (prompt, options) => {
        calls.push({ prompt, options })
        options.deps.out('{"decisions":[]}')
        return Promise.resolve({ ok: true, error: null })
      }
    })

    expect(result).toEqual({ ok: true, text: '{"decisions":[]}', error: null })
    expect(calls[0].options.skillId).toBe('git-reconcile')
    expect(calls[0].options.tier).toBe('max')
    expect(calls[0].options.cwd).toBe('/repo')
  })
})

describe('runGitReconcileOrchestrator', () => {
  test('JS інвентаризує, LLM лише класифікує, PR pipeline отримує одну вибрану group', async () => {
    const prCalls = []
    const logs = []
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      runner: 'pi',
      task: 'тільки завершене',
      log: line => logs.push(line),
      deps: {
        inventoryRepository: () => inventory(),
        callRunner: () =>
          Promise.resolve({
            ok: true,
            error: null,
            text: JSON.stringify({
              decisions: [
                {
                  source: REVIEW_BRANCH.source,
                  action: 'pr',
                  rationale: 'готовий fix',
                  groups: [{ title: 'fix: useful', commits: ['abc123'] }]
                },
                {
                  source: 'stash:stash@{0}',
                  action: 'drop',
                  rationale: 'тимчасовий debug',
                  groups: []
                }
              ]
            })
          }),
        createPullRequest: args => {
          prCalls.push(args)
          return Promise.resolve({
            status: 'pr-created',
            branch: 'codex/reconcile-useful',
            url: 'https://example.test/pr/1'
          })
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(prCalls).toHaveLength(1)
    expect(prCalls[0].candidate.source).toBe(REVIEW_BRANCH.source)
    expect(prCalls[0].group.commits).toEqual(['abc123'])
    expect(result.results).toEqual([
      {
        source: REVIEW_BRANCH.source,
        status: 'pr-created',
        branch: 'codex/reconcile-useful',
        url: 'https://example.test/pr/1'
      },
      {
        source: 'stash:stash@{0}',
        status: 'drop-recommended',
        rationale: 'тимчасовий debug'
      }
    ])
    expect(logs.at(-1)).toContain('drop-recommended')
  })

  test('невалідна LLM-відповідь fail-closed лишає source як kept', async () => {
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: () => {},
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        callRunner: () => Promise.resolve({ ok: true, error: null, text: 'not-json' }),
        createPullRequest: () => {
          throw new Error('не має викликатися')
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(result.results).toEqual([
      {
        source: REVIEW_BRANCH.source,
        status: 'kept',
        rationale: 'Невалідна LLM-відповідь'
      }
    ])
  })

  test('failed PR preparation робить загальний результат failed і зберігає worktree path', async () => {
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: () => {},
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        callRunner: () =>
          Promise.resolve({
            ok: true,
            error: null,
            text: JSON.stringify({
              decisions: [
                {
                  source: REVIEW_BRANCH.source,
                  action: 'pr',
                  groups: [{ title: 'fix: useful', commits: ['abc123'] }]
                }
              ]
            })
          }),
        createPullRequest: () =>
          Promise.resolve({
            status: 'failed',
            error: 'tests failed',
            worktree: '/repo/.worktrees/reconcile-useful'
          })
      }
    })

    expect(result.ok).toBe(false)
    expect(result.report).toContain('tests failed')
    expect(result.results[0].worktree).toBe('/repo/.worktrees/reconcile-useful')
  })
})

describe('report helpers', () => {
  test('branchSlug обмежує ref до безпечного короткого slug', () => {
    expect(branchSlug('Fix: Привіт / API!!!')).toBe('fix-api')
    expect(branchSlug('***')).toBe('change')
  })

  test('formatReport показує merged/protected/PR і warnings', () => {
    const report = formatReport({
      inventory: inventory({
        branches: [
          { name: 'merged', state: 'merged' },
          { name: 'protected', state: 'protected', worktree: '/repo/.worktrees/protected' },
          { name: 'with-pr', state: 'open-pr', pr: { url: 'https://example.test/pr/2' } }
        ],
        stashes: [],
        warnings: ['gh недоступний']
      }),
      results: []
    })

    expect(report).toContain('`merged`: merged')
    expect(report).toContain('/repo/.worktrees/protected')
    expect(report).toContain('https://example.test/pr/2')
    expect(report).toContain('gh недоступний')
  })
})
