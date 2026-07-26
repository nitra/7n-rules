/**
 * Тести git-reconcile: парсинг Git inventory, bounded LLM contract і
 * orchestration без реальних worktree/push/PR.
 */
import { env } from 'node:process'

import { describe, expect, test } from 'vitest'

import {
  acceptsTestOutcome,
  branchSlug,
  buildTriagePrompt,
  callRunner,
  callWithValidatedFallback,
  cleanupSource,
  conflictFiles,
  dedupeRefs,
  formatReport,
  parseDecisionEnvelope,
  parseWorktrees,
  runGitReconcileOrchestrator,
  skipEmptyCherryPick,
  sourceDirectories,
  testFailureSignatures,
  validateBehaviorState,
  validateTriageOutcome
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

/**
 * Формує мінімальний inventory для orchestration tests.
 * @param {object} [overrides] часткові заміни полів
 * @returns {object} inventory
 */
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

/** Порожній test logger. */
function noop() {
  // Навмисно порожньо: цей тест не перевіряє progress output.
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
        worktree: '/repo/.worktrees/feature-a',
        aliases: ['refs/heads/feature/a', 'refs/remotes/origin/feature/a']
      }
    ])
  })

  test('dedupeRefs захищає branch за HEAD OID detached worktree', () => {
    const refs = dedupeRefs(
      [{ ref: 'refs/heads/detached-feature', oid: 'detached-oid', date: '2026-01-01' }],
      new Map(),
      new Map([['detached-oid', '/repo/.worktrees/detached-feature']])
    )

    expect(refs[0].worktree).toBe('/repo/.worktrees/detached-feature')
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

  test('callRunner pi передає заданий tier і збирає streaming text', async () => {
    const calls = []
    const result = await callRunner(
      'pi',
      'triage',
      '/repo',
      {
        runAgentSkill: (prompt, options) => {
          calls.push({ prompt, options })
          options.deps.out('{"decisions":[]}')
          return Promise.resolve({ ok: true, error: null })
        }
      },
      'min'
    )

    expect(result).toEqual({ ok: true, text: '{"decisions":[]}', error: null })
    expect(calls[0].options.skillId).toBe('git-reconcile')
    expect(calls[0].options.tier).toBe('min')
    expect(calls[0].options.cwd).toBe('/repo')
  })

  test('callRunner cursor/codex передає tier у ACP preset', async () => {
    const calls = []
    const result = await callRunner(
      'codex',
      'triage',
      '/repo',
      {
        runAcpAgent: (runner, prompt, cwd, options) => {
          calls.push({ runner, prompt, cwd, options })
          return Promise.resolve('{"decisions":[]}')
        }
      },
      'min'
    )

    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      {
        runner: 'codex',
        prompt: 'triage',
        cwd: '/repo',
        options: { tier: 'min' }
      }
    ])
  })

  test('validated fallback приймає min без виклику max', async () => {
    const tiers = []
    const result = await callWithValidatedFallback({
      runner: 'codex',
      prompt: 'triage',
      cwd: '/repo',
      deps: {
        callRunner: (_runner, _prompt, _cwd, _deps, tier) => {
          tiers.push(tier)
          return Promise.resolve({ ok: true, text: 'valid', error: null })
        }
      },
      validate: outcome => ({ ok: outcome.text === 'valid' })
    })

    expect(tiers).toEqual(['min'])
    expect(result.tier).toBe('min')
    expect(result.ok).toBe(true)
  })

  test('validated fallback після провалу min повторює на max із причиною', async () => {
    const calls = []
    const logs = []
    const attempts = []
    const result = await callWithValidatedFallback({
      runner: 'cursor',
      prompt: 'resolve',
      cwd: '/repo',
      log: line => {
        logs.push(line)
      },
      label: 'conflict c1',
      onAttempt: attempt => {
        attempts.push(attempt)
      },
      deps: {
        callRunner: (_runner, prompt, _cwd, _deps, tier) => {
          calls.push({ prompt, tier })
          return Promise.resolve({ ok: true, text: tier, error: null })
        }
      },
      validate: outcome =>
        outcome.text === 'max' ? { ok: true } : { ok: false, error: 'нерозвʼязані конфлікти: src/a.mjs' }
    })

    expect(calls.map(call => call.tier)).toEqual(['min', 'max'])
    expect(calls[1].prompt).toContain('нерозвʼязані конфлікти')
    expect(logs[0]).toContain('min не пройшов validation')
    expect(attempts).toEqual([
      { label: 'conflict c1', tier: 'min' },
      { label: 'conflict c1', tier: 'max' }
    ])
    expect(result.tier).toBe('max')
  })

  test('validated fallback fail-closed після провалу max', async () => {
    const result = await callWithValidatedFallback({
      runner: 'pi',
      prompt: 'resolve',
      cwd: '/repo',
      deps: {
        callRunner: (_runner, _prompt, _cwd, _deps, tier) => Promise.resolve({ ok: true, text: tier, error: null })
      },
      validate: () => ({ ok: false, error: 'tests failed' })
    })

    expect(result.ok).toBe(false)
    expect(result.tier).toBe('max')
    expect(result.error).toBe('tests failed')
    expect(result.attempts.map(attempt => attempt.tier)).toEqual(['min', 'max'])
  })

  test('runner failure завершується на min без марного max fallback', async () => {
    const tiers = []
    const result = await callWithValidatedFallback({
      runner: 'codex',
      prompt: 'triage',
      cwd: '/repo',
      deps: {
        callRunner: (_runner, _prompt, _cwd, _deps, tier) => {
          tiers.push(tier)
          return Promise.resolve({ ok: false, text: '', error: 'ACP handshake failed' })
        }
      },
      validate: () => {
        throw new Error('runner failure не має доходити до validation')
      }
    })

    expect(tiers).toEqual(['min'])
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ACP handshake failed')
  })
})

describe('triage validation', () => {
  test('приймає повний verdict і subset відомих commits', () => {
    const outcome = {
      text: JSON.stringify({
        decisions: [
          {
            source: REVIEW_BRANCH.source,
            action: 'pr',
            groups: [{ title: 'fix: useful', commits: ['abc123'] }]
          }
        ]
      })
    }

    expect(validateTriageOutcome(outcome, [REVIEW_BRANCH]).ok).toBe(true)
  })

  test('відхиляє невідомий commit і неповний список candidates', () => {
    const unknownCommit = {
      text: JSON.stringify({
        decisions: [
          {
            source: REVIEW_BRANCH.source,
            action: 'pr',
            groups: [{ title: 'fix: useful', commits: ['unknown'] }]
          }
        ]
      })
    }
    const missingDecision = { text: '{"decisions":[]}' }

    expect(validateTriageOutcome(unknownCommit, [REVIEW_BRANCH]).error).toContain('невідомий commit')
    expect(validateTriageOutcome(missingDecision, [REVIEW_BRANCH]).error).toContain('кількість decisions')
  })

  test('відхиляє повтор commit між groups і поділ stash на кілька PR', () => {
    const repeatedCommit = {
      text: JSON.stringify({
        decisions: [
          {
            source: REVIEW_BRANCH.source,
            action: 'pr',
            groups: [
              { title: 'fix: one', commits: ['abc123'] },
              { title: 'fix: two', commits: ['abc123'] }
            ]
          }
        ]
      })
    }
    const stash = inventory().stashes[0]
    const splitStash = {
      text: JSON.stringify({
        decisions: [
          {
            source: stash.source,
            action: 'pr',
            groups: [{ title: 'fix: one' }, { title: 'fix: two' }]
          }
        ]
      })
    }

    expect(validateTriageOutcome(repeatedCommit, [REVIEW_BRANCH]).error).toContain('повторюється')
    expect(validateTriageOutcome(splitStash, [stash]).error).toContain('неподільний stash')
  })
})

describe('worktree validation', () => {
  test('scoped gates отримують лише унікальні директорії зміненого коду', () => {
    expect(
      sourceDirectories([
        'gt/src/router.js',
        'gt/src/router-url.mjs',
        'gt/tests/router.test.mjs',
        'gt/README.md',
        'deleted.txt'
      ])
    ).toEqual(['gt/src', 'gt/tests'])
  })

  test('test signatures відокремлюють baseline failures від summary', () => {
    const escape = String.fromCodePoint(27)
    const signatures = testFailureSignatures(
      `${escape}[31m FAIL  cf/check.test.mjs > main > existing${escape}[0m\n FAIL  gt/router.test.mjs [ gt/router.test.mjs ]`
    )
    expect([...signatures]).toEqual([
      'cf/check.test.mjs > main > existing',
      'gt/router.test.mjs [ gt/router.test.mjs ]'
    ])
  })

  test('red baseline дозволяє лише підмножину відомих Vitest failures', () => {
    const baseline = {
      status: 1,
      stdout: ' FAIL  cf/check.test.mjs > main > existing\n FAIL  old.test.mjs > old',
      stderr: ''
    }
    expect(
      acceptsTestOutcome(baseline, {
        status: 1,
        stdout: ' FAIL  cf/check.test.mjs > main > existing',
        stderr: ''
      })
    ).toBe(true)
    expect(
      acceptsTestOutcome(baseline, {
        status: 1,
        stdout: ' FAIL  cf/check.test.mjs > main > existing\n FAIL  gt/router.test.mjs > regression',
        stderr: ''
      })
    ).toBe(false)
  })

  test('нерозпізнаний red baseline не обходить test gate', () => {
    expect(
      acceptsTestOutcome(
        { status: 1, stdout: 'process crashed', stderr: '' },
        { status: 1, stdout: 'process crashed', stderr: '' }
      )
    ).toBe(false)
  })

  test('empty cherry-pick пропускається лише за активного sequencer і порожнього staged diff', () => {
    const calls = []
    const skipped = skipEmptyCherryPick('/repo', (_command, args) => {
      calls.push(args)
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'oid\n', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(skipped).toBe(true)
    expect(calls).toContainEqual(['cherry-pick', '--skip'])
  })

  test('generic cherry-pick failure не маскується як empty', () => {
    const calls = []
    const skipped = skipEmptyCherryPick('/repo', (_command, args) => {
      calls.push(args)
      if (args[0] === 'rev-parse') return { status: 1, stdout: '', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(skipped).toBe(false)
    expect(calls).not.toContainEqual(['cherry-pick', '--skip'])
  })

  test('приймає clean Git state, зелений test script і changelog gate', () => {
    const calls = []
    const result = validateBehaviorState(process.cwd(), (command, args) => {
      calls.push([command, args])
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toContainEqual(['bun', ['run', 'test']])
    expect(calls).toContainEqual(['npx', ['@7n/rules', 'lint', 'changelog', '--no-fix']])
  })

  test('test failure блокує min-результат до changelog gate', () => {
    const calls = []
    const result = validateBehaviorState(process.cwd(), (command, args) => {
      calls.push([command, args])
      if (command === 'bun') return { status: 1, stdout: '', stderr: 'regression' }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('regression')
    expect(calls.some(([command]) => command === 'npx')).toBe(false)
  })

  test('nested npx не успадковує package selector зовнішнього npm exec', () => {
    const previous = env.npm_config_package
    env.npm_config_package = '/tmp/outer-package'
    let npxEnv
    try {
      const result = validateBehaviorState('/repo-without-package-json', (command, _args, options) => {
        if (command === 'npx') npxEnv = options.env
        return { status: 0, stdout: '', stderr: '' }
      })
      expect(result).toEqual({ ok: true })
      expect(npxEnv).not.toHaveProperty('npm_config_package')
    } finally {
      if (previous === undefined) delete env.npm_config_package
      else env.npm_config_package = previous
    }
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
      log: line => {
        logs.push(line)
      },
      deps: {
        now: (() => {
          let value = 0
          return () => {
            value += 0.2
            return value
          }
        })(),
        inventoryRepository: () => inventory(),
        cleanupSource: candidate => ({ status: `removed:${candidate.source}` }),
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
        url: 'https://example.test/pr/1',
        cleanup: { status: `removed:${REVIEW_BRANCH.source}` }
      },
      {
        source: 'stash:stash@{0}',
        status: 'drop-recommended',
        rationale: 'тимчасовий debug',
        cleanup: { status: 'removed:stash:stash@{0}' }
      }
    ])
    expect(logs).toContain('⏳ 1/4 inventory')
    expect(logs.some(line => line.startsWith('✅ 1/4 inventory · 0 ms'))).toBe(true)
    expect(logs.some(line => line.includes('2/4 triage · 1-2/2 · min'))).toBe(true)
    expect(logs.some(line => line.includes('1/1 triage-пакетів'))).toBe(true)
    expect(logs.some(line => line.includes(`3/4 PR · 1/1 · ${REVIEW_BRANCH.source} · worktree`))).toBe(true)
    expect(logs.some(line => line.includes('4/4 cleanup · stash:stash@{0}'))).toBe(true)
    expect(logs.some(line => line.includes('3/3 джерел'))).toBe(true)
    expect(logs.at(-1)).toContain('drop-recommended')
  })

  test('невалідні min і max відповіді fail-closed лишають source як kept', async () => {
    const tiers = []
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        cleanupSource: () => ({ status: 'removed' }),
        callRunner: (_runner, _prompt, _cwd, _deps, tier) => {
          tiers.push(tier)
          return Promise.resolve({ ok: true, error: null, text: 'not-json' })
        },
        createPullRequest: () => {
          throw new Error('не має викликатися')
        }
      }
    })

    expect(result.ok).toBe(false)
    expect(tiers).toEqual(['min', 'max'])
    expect(result.results[0].source).toBe(REVIEW_BRANCH.source)
    expect(result.results[0].status).toBe('kept')
    expect(result.results[0].rationale).toContain('LLM triage failed')
  })

  test('failed PR preparation робить загальний результат failed і зберігає worktree path', async () => {
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        cleanupSource: () => ({ status: 'removed' }),
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

describe('cleanupSource', () => {
  test('branch cleanup видаляє точні local і remote aliases без shell', () => {
    const calls = []
    const result = cleanupSource(
      {
        source: REVIEW_BRANCH.source,
        ref: REVIEW_BRANCH.ref,
        aliases: ['refs/heads/feature/a', 'refs/remotes/origin/feature/a']
      },
      '/repo',
      (command, args) => {
        calls.push([command, args])
        return { status: 0, stdout: '', stderr: '' }
      }
    )

    expect(result).toEqual({ status: 'removed' })
    expect(calls).toEqual([
      ['git', ['branch', '-D', 'feature/a']],
      ['git', ['push', 'origin', '--delete', 'feature/a']]
    ])
  })

  test('stash cleanup повторно знаходить ref за стабільним OID', () => {
    const calls = []
    const result = cleanupSource({ source: 'stash:stash@{4}', oid: 'stash-oid' }, '/repo', (command, args) => {
      calls.push([command, args])
      if (args[0] === 'stash' && args[1] === 'list') {
        return { status: 0, stdout: 'stash@{1}\0stash-oid\n', stderr: '' }
      }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(result).toEqual({ status: 'removed' })
    expect(calls.at(-1)).toEqual(['git', ['stash', 'drop', 'stash@{1}']])
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
          { name: 'merged', state: 'merged', oid: 'merged-oid', cleanup: { status: 'removed' } },
          { name: 'protected', state: 'protected', worktree: '/repo/.worktrees/protected' },
          { name: 'with-pr', state: 'open-pr', pr: { url: 'https://example.test/pr/2' } }
        ],
        stashes: [],
        warnings: ['gh недоступний']
      }),
      results: []
    })

    expect(report).toContain('`merged`: merged')
    expect(report).toContain('cleanup=removed; oid=merged-oid')
    expect(report).toContain('/repo/.worktrees/protected')
    expect(report).toContain('https://example.test/pr/2')
    expect(report).toContain('gh недоступний')
  })
})
