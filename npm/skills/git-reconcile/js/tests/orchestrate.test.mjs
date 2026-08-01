/**
 * Тести git-reconcile: парсинг Git inventory, bounded LLM contract і
 * orchestration без реальних worktree/push/PR.
 */
// cspell:ignore gitdir lockfiles
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { env } from 'node:process'
import { delimiter, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { describe, expect, test } from 'vitest'

import {
  acceptsTestOutcome,
  branchSlug,
  buildTriagePrompt,
  callRunner,
  callWithValidatedFallback,
  captureCachedBehaviorBaseline,
  changedNonCodeDirectories,
  changedNonCodeScopes,
  classifyPullRequestChecks,
  cleanupObsoleteWorktrees,
  cleanupSource,
  collectPullRequestFacts,
  commitPendingChanges,
  conflictFiles,
  createPhaseProgress,
  dedupeRefs,
  describePullRequest,
  discardPatchEquivalentWorktree,
  ensureLocalWorktreeExclude,
  finishCherryPick,
  formatOutcomeCounts,
  formatReport,
  groupTrackingRefs,
  hasChangesFromBase,
  hasOnlyChangeEntries,
  inventoryStashes,
  nativeExecutableEnvironment,
  normalizePrConcurrency,
  parseDecisionEnvelope,
  parseWorktreeInventory,
  parseWorktrees,
  passFinalProjectGates,
  pullRequestDiffProfile,
  pruneForensicDependencies,
  releasedChangeEntries,
  remediateBehaviorState,
  renderPullRequestBody,
  runAsync,
  runGitReconcileOrchestrator,
  runWithConcurrency,
  skipEmptyCherryPick,
  sourceDirectories,
  summarizeRemaining,
  testFailureSignatures,
  trackingRelation,
  validateBehaviorState,
  validateAppliedValueReview,
  validateChangedLockfiles,
  validateFinalProjectGates,
  validatePullRequestDescription,
  validateTriageOutcome,
  verificationSummary,
  verifyPullRequestReadiness
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
const NPM_ROOT = resolve(import.meta.dirname, '../../../..')

test('native executable PATH відкидає project-local npm і npx shims', () => {
  const sourcePath = [
    '/repo/node_modules/.bin',
    '/tmp/.npm/_npx/hash/node_modules/.bin',
    '/opt/homebrew/bin',
    '/usr/bin'
  ].join(delimiter)
  const result = nativeExecutableEnvironment({ PATH: sourcePath, KEEP: 'yes' })

  expect(result).toEqual({
    PATH: ['/opt/homebrew/bin', '/usr/bin'].join(delimiter),
    KEEP: 'yes'
  })
})

/**
 * Емулює Git-відповіді для tracked, untracked, duplicate й absorbed stashes.
 * @param {string} _command binary
 * @param {string[]} args Git args
 * @param {{input?:string}} options spawn options
 * @returns {{status:number,stdout:string,stderr:string}} command result
 */
function stashInventorySpawn(_command, args, options) {
  const command = args.join(' ')
  if (command === 'stash list --format=%gd%x00%H%x00%gs') {
    return {
      status: 0,
      stdout: [
        'stash@{0}\0oid-0\0newest untracked',
        'stash@{1}\0oid-1\0older duplicate',
        'stash@{2}\0oid-2\0absorbed tracked'
      ].join('\n'),
      stderr: ''
    }
  }
  if (command.startsWith('stash show --name-status --include-untracked')) {
    const path = command.endsWith('stash@{2}') ? 'M\tsrc/absorbed.mjs' : 'A\tdocs/untracked.md'
    return { status: 0, stdout: `${path}\n`, stderr: '' }
  }
  if (command.startsWith('stash show --patch --binary --include-untracked')) {
    const patch = command.endsWith('stash@{2}') ? 'patch-absorbed' : 'patch-untracked'
    return { status: 0, stdout: patch, stderr: '' }
  }
  if (command === 'hash-object --stdin') {
    const hash = options.input === 'patch-absorbed' ? 'hash-absorbed' : 'hash-untracked'
    return { status: 0, stdout: `${hash}\n`, stderr: '' }
  }
  if (command.startsWith('diff --name-only')) {
    const paths = command.includes('stash@{2}') ? 'src/absorbed.mjs\n' : ''
    return { status: 0, stdout: paths, stderr: '' }
  }
  if (command.startsWith('rev-parse --verify')) {
    return { status: command.includes('stash@{2}') ? 1 : 0, stdout: 'third-parent\n', stderr: '' }
  }
  if (command.startsWith('ls-tree -r --name-only')) {
    return { status: 0, stdout: 'docs/untracked.md\n', stderr: '' }
  }
  if (command.startsWith('diff --quiet origin/main stash@{2}')) {
    return { status: 0, stdout: '', stderr: '' }
  }
  if (command.startsWith('diff --quiet origin/main stash@{')) {
    return { status: 1, stdout: '', stderr: '' }
  }
  throw new Error(`unexpected command: ${command}`)
}

describe('commitPendingChanges', () => {
  test('приймає чистий index, коли корисні commits уже є в branch', () => {
    const calls = []
    const committed = commitPendingChanges('/repo', 'fix: useful', (command, args) => {
      calls.push([command, args])
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(committed).toBe(false)
    expect(calls).toEqual([
      ['git', ['add', '-A']],
      ['git', ['diff', '--cached', '--quiet']]
    ])
  })

  test('комітить staged remediation після final gates', () => {
    const calls = []
    const committed = commitPendingChanges('/repo', 'fix: useful', (command, args) => {
      calls.push([command, args])
      return { status: args[0] === 'diff' ? 1 : 0, stdout: '', stderr: '' }
    })

    expect(committed).toBe(true)
    expect(calls.at(-1)).toEqual(['git', ['commit', '-m', 'fix: useful']])
  })
})

describe('forensic worktree hygiene', () => {
  test('видаляє лише відновлюваний node_modules', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-forensic-'))
    mkdirSync(resolve(root, 'node_modules'))
    writeFileSync(resolve(root, 'node_modules', 'package.json'), '{}')
    writeFileSync(resolve(root, 'evidence.txt'), 'keep')

    try {
      expect(pruneForensicDependencies(root)).toBe(true)
      expect(existsSync(resolve(root, 'node_modules'))).toBe(false)
      expect(readFileSync(resolve(root, 'evidence.txt'), 'utf8')).toBe('keep')
      expect(pruneForensicDependencies(root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('повторно чекає checks після порожнього initial rollup', async () => {
    let viewCount = 0
    const delays = []
    const result = await verifyPullRequestReadiness({
      url: 'https://example.test/pr/1',
      cwd: '/repo',
      delayFn: milliseconds => {
        delays.push(milliseconds)
        return Promise.resolve()
      },
      asyncSpawnFn: (_command, args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          viewCount += 1
          return Promise.resolve({
            status: 0,
            stdout: JSON.stringify({
              baseRefOid: 'base',
              statusCheckRollup: viewCount === 1 ? [] : [{ name: 'lint', conclusion: 'SUCCESS' }]
            }),
            stderr: ''
          })
        }
        if (args[0] === 'repo') return Promise.resolve({ status: 0, stdout: 'owner/repo\n', stderr: '' })
        if (args[0] === 'api') {
          return Promise.resolve({
            status: 0,
            stdout: JSON.stringify({ check_runs: [{ name: 'lint', conclusion: 'SUCCESS' }] }),
            stderr: ''
          })
        }
        return Promise.resolve({ status: 0, stdout: '', stderr: '' })
      }
    })

    expect(delays).toEqual([10_000])
    expect(result).toEqual({ status: 'ready' })
  })

  test('чекає кілька registration ticks, а не лише один', async () => {
    let viewCount = 0
    const delays = []
    const result = await verifyPullRequestReadiness({
      url: 'https://example.test/pr/1',
      cwd: '/repo',
      delayFn: milliseconds => {
        delays.push(milliseconds)
        return Promise.resolve()
      },
      asyncSpawnFn: (_command, args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          viewCount += 1
          return Promise.resolve({
            status: 0,
            stdout: JSON.stringify({
              baseRefOid: 'base',
              statusCheckRollup: viewCount < 4 ? [] : [{ name: 'lint', conclusion: 'SUCCESS' }]
            }),
            stderr: ''
          })
        }
        if (args[0] === 'repo') return Promise.resolve({ status: 0, stdout: 'owner/repo\n', stderr: '' })
        if (args[0] === 'api') {
          return Promise.resolve({
            status: 0,
            stdout: JSON.stringify({ check_runs: [{ name: 'lint', conclusion: 'SUCCESS' }] }),
            stderr: ''
          })
        }
        return Promise.resolve({ status: 0, stdout: '', stderr: '' })
      }
    })

    expect(delays).toEqual([10_000, 10_000, 10_000])
    expect(result).toEqual({ status: 'ready' })
  })

  test('merged PR є terminally absorbed без очікування check rollup', async () => {
    const result = await verifyPullRequestReadiness({
      url: 'https://example.test/pr/1',
      cwd: '/repo',
      asyncSpawnFn: (_command, args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return Promise.resolve({
            status: 0,
            stdout: JSON.stringify({ baseRefOid: 'base', statusCheckRollup: [], mergedAt: '2026-07-30T08:00:00Z' }),
            stderr: ''
          })
        }
        return Promise.resolve({ status: 0, stdout: '', stderr: '' })
      }
    })

    expect(result).toEqual({ status: 'ready' })
  })
})

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
    worktrees: [],
    warnings: [],
    ...overrides
  }
}

/** Порожній test logger. */
function noop() {
  // Навмисно порожньо: цей тест не перевіряє progress output.
}

/**
 * Формує fake runner для негативних final-gate сценаріїв.
 * @param {'domain'|'changelog'} failedStage етап, який має впасти
 * @returns {(command:string,args:string[])=>{status:number,stdout:string,stderr:string}} spawn-compatible runner
 */
function finalGateSpawn(failedStage) {
  return (command, args) => {
    if (command === 'git' && args[0] === 'diff') {
      return { status: 0, stdout: 'skills/git-reconcile/SKILL.md\n', stderr: '' }
    }
    if (command === 'npx' && failedStage === 'domain' && args.includes('--path')) {
      return { status: 1, stdout: '', stderr: 'domain failed' }
    }
    if (command === 'npx' && failedStage === 'changelog' && args.includes('changelog')) {
      return { status: 1, stdout: '', stderr: 'changelog failed' }
    }
    return { status: 0, stdout: '', stderr: '' }
  }
}

/**
 * Повертає відносний шлях локального Git exclude для test spawn.
 * @returns {{status:number,stdout:string,stderr:string}} fake spawn result
 */
function localExcludeGitPath() {
  return {
    status: 0,
    stdout: '.git/info/exclude\n',
    stderr: ''
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

  test('parseWorktreeInventory зберігає detached, prunable і locked records', () => {
    expect(
      parseWorktreeInventory(
        [
          'worktree /repo/.claude/worktrees/stale',
          'HEAD abc',
          'detached',
          'prunable gitdir file points to non-existent location',
          '',
          'worktree /repo/.worktrees/locked',
          'HEAD def',
          'branch refs/heads/locked',
          'locked busy',
          ''
        ].join('\n')
      )
    ).toEqual([
      {
        path: '/repo/.claude/worktrees/stale',
        head: 'abc',
        branch: null,
        detached: true,
        prunable: true,
        locked: false
      },
      {
        path: '/repo/.worktrees/locked',
        head: 'def',
        branch: 'refs/heads/locked',
        detached: false,
        prunable: false,
        locked: true
      }
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

  test('trackingRelation класифікує ancestry лише read-only merge-base перевірками', () => {
    const commands = []
    const spawnFn = (_command, args) => {
      commands.push(args)
      const pair = `${args[2]}:${args[3]}`
      return { status: ['local:remote', 'remote:ahead'].includes(pair) ? 0 : 1, stdout: '', stderr: '' }
    }

    expect(trackingRelation('same', 'same', '/repo', spawnFn)).toBe('synced')
    expect(trackingRelation('local', 'remote', '/repo', spawnFn)).toBe('behind-only')
    expect(trackingRelation('ahead', 'remote', '/repo', spawnFn)).toBe('ahead')
    expect(trackingRelation('left', 'right', '/repo', spawnFn)).toBe('diverged')
    expect(commands.every(args => args.slice(0, 2).join(' ') === 'merge-base --is-ancestor')).toBe(true)
  })

  test('groupTrackingRefs аналізує behind local branch за effective remote tip', () => {
    const localRef = 'refs/heads/feature/a'
    const upstreamRef = 'refs/remotes/origin/feature/a'
    const refs = groupTrackingRefs(
      [
        { ref: localRef, oid: 'local-oid', date: '2026-01-01', upstream: upstreamRef },
        { ref: upstreamRef, oid: 'remote-oid', date: '2026-01-02', upstream: '' }
      ],
      new Map([[localRef, '/repo/.worktrees/feature-a']]),
      new Map(),
      ['main'],
      () => 'behind-only'
    )

    expect(refs).toEqual([
      {
        ref: upstreamRef,
        oid: 'remote-oid',
        date: '2026-01-02',
        upstream: '',
        aliases: [localRef, upstreamRef],
        worktree: '/repo/.worktrees/feature-a',
        tracking: {
          state: 'behind-only',
          localRef,
          upstreamRef,
          localOid: 'local-oid',
          upstreamOid: 'remote-oid'
        }
      }
    ])
  })

  test('groupTrackingRefs бере local tip для ahead і не зливає diverged refs', () => {
    const localRef = 'refs/heads/feature/a'
    const upstreamRef = 'refs/remotes/origin/feature/a'
    const raw = [
      { ref: localRef, oid: 'local-oid', date: '2026-01-02', upstream: upstreamRef },
      { ref: upstreamRef, oid: 'remote-oid', date: '2026-01-01', upstream: '' }
    ]
    const ahead = groupTrackingRefs(raw, new Map(), new Map(), ['main'], () => 'ahead')
    const diverged = groupTrackingRefs(raw, new Map(), new Map(), ['main'], () => 'diverged')

    expect(ahead).toHaveLength(1)
    expect(ahead[0]).toMatchObject({
      ref: localRef,
      oid: 'local-oid',
      aliases: [localRef, upstreamRef],
      tracking: { state: 'ahead' }
    })
    expect(diverged).toHaveLength(2)
    expect(diverged.map(item => [item.ref, item.aliases, item.tracking.state])).toEqual([
      [localRef, [localRef], 'diverged'],
      [upstreamRef, [upstreamRef], 'diverged']
    ])
  })

  test('inventoryStashes бачить untracked payload і детерміновано відсіює absorbed та exact duplicate', () => {
    const stashes = inventoryStashes('/repo', 'origin/main', stashInventorySpawn)

    expect(stashes[0]).toMatchObject({
      source: 'stash:stash@{0}',
      state: 'review',
      changedFiles: ['A\tdocs/untracked.md']
    })
    expect(stashes[1]).toMatchObject({
      state: 'patch-equivalent',
      equivalence: 'duplicate-of:stash:stash@{0}'
    })
    expect(stashes[2]).toMatchObject({
      state: 'patch-equivalent',
      equivalence: 'absorbed-in-base'
    })
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
  test('semantic obsolete review приймає лише пояснений proceed або obsolete verdict', () => {
    expect(validateAppliedValueReview('{"verdict":"obsolete","rationale":"поведінка вже є в main"}')).toEqual({
      ok: true,
      value: { verdict: 'obsolete', rationale: 'поведінка вже є в main' }
    })
    expect(validateAppliedValueReview('{"verdict":"drop","rationale":"безпечно"}').ok).toBe(false)
    expect(validateAppliedValueReview('{"verdict":"proceed","rationale":""}').ok).toBe(false)
  })

  test('triage prompt забороняє Git-дії моделі й містить лише підготовлені facts', () => {
    const prompt = buildTriagePrompt([REVIEW_BRANCH], 'збережи завершені fixes')

    expect(prompt).toContain('Не запускай команди')
    expect(prompt).toContain('лише JSON')
    expect(prompt).toContain('збережи завершені fixes')
    expect(prompt).toContain(REVIEW_BRANCH.source)
    expect(prompt).toContain('Conflict сам по собі НЕ є причиною keep')
    expect(prompt).toContain('semantic conflict resolution')
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

  test('callRunner приховує ACP event spam і відновлює env після виклику', async () => {
    const previous = env.N_LLM_ACP_PROGRESS
    delete env.N_LLM_ACP_PROGRESS
    let progressDuringCall
    try {
      await callRunner(
        'codex',
        'triage',
        '/repo',
        {
          runAcpAgent: () => {
            progressDuringCall = env.N_LLM_ACP_PROGRESS
            return Promise.resolve('done')
          }
        },
        'min'
      )
      expect(progressDuringCall).toBe('0')
      expect(env.N_LLM_ACP_PROGRESS).toBeUndefined()
    } finally {
      if (previous === undefined) delete env.N_LLM_ACP_PROGRESS
      else env.N_LLM_ACP_PROGRESS = previous
    }
  })

  test('callRunner перетворює transport failure ACP у структуровану помилку', async () => {
    const result = await callRunner(
      'codex',
      'resolve',
      '/repo',
      {
        runAcpAgent: () => Promise.reject(new Error('acp: немає змістовного agent/tool прогресу 180s — ймовірно завис'))
      },
      'max'
    )

    expect(result.ok).toBe(false)
    expect(result.text).toBe('')
    expect(result.error).toContain('немає змістовного agent/tool прогресу')
  })

  test('transport failure ACP — infrastructure failure: без max retry, batch завершується', async () => {
    const tiers = []
    const result = await callWithValidatedFallback({
      runner: 'codex',
      prompt: 'resolve',
      cwd: '/repo',
      deps: {
        runAcpAgent: (_runner, _prompt, _cwd, options) => {
          tiers.push(options.tier)
          return Promise.reject(new Error('acp: transport failure'))
        }
      },
      validate: () => {
        throw new Error('transport failure не має доходити до validation')
      }
    })

    expect(tiers).toEqual(['min'])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('transport failure')
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

  test('validated fallback передає command denylist runner-у', async () => {
    const runnerOptions = []
    await callWithValidatedFallback({
      runner: 'codex',
      prompt: 'behavior',
      cwd: '/repo',
      runnerOptions: { denyCommandFragments: ['bun run test'] },
      deps: {
        callRunner: (_runner, _prompt, _cwd, _deps, _tier, options) => {
          runnerOptions.push(options)
          return Promise.resolve({ ok: true, text: 'done', error: null })
        }
      },
      validate: () => ({ ok: true })
    })

    expect(runnerOptions).toEqual([{ denyCommandFragments: ['bun run test'] }])
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

  test('canonical remediation приймає min без виклику max', async () => {
    const tiers = []
    let validationCount = 0
    const result = await callWithValidatedFallback({
      runner: 'codex',
      prompt: 'behavior',
      cwd: '/repo',
      deps: {
        callRunner: (_runner, _prompt, _cwd, _deps, tier) => {
          tiers.push(tier)
          return Promise.resolve({ ok: true, text: 'done', error: null })
        }
      },
      validate: () => {
        validationCount += 1
        return validationCount === 1
          ? { ok: false, error: 'missing changeset', remediation: 'canonical-fixers' }
          : { ok: true }
      },
      remediate: validation => ({
        attempted: validation.remediation === 'canonical-fixers',
        ok: true
      })
    })

    expect(tiers).toEqual(['min'])
    expect(result.tier).toBe('min')
    expect(result.remediated).toBe(true)
    expect(result.attempts[0].remediation).toEqual({ attempted: true, ok: true })
  })

  test('PR facts збираються з фінального range', () => {
    const calls = []
    const facts = collectPullRequestFacts({
      cwd: '/repo',
      baseRef: 'origin/main',
      source: REVIEW_BRANCH.source,
      title: 'fix: useful',
      rationale: 'готовий fix',
      verification: 'tests pass',
      spawnFn: (command, args) => {
        calls.push([command, args])
        const joined = args.join(' ')
        if (joined.includes('--name-only')) return { status: 0, stdout: 'src/a.mjs\nREADME.md\n', stderr: '' }
        if (args[0] === 'log') return { status: 0, stdout: 'abc123\tfix: useful\n', stderr: '' }
        if (joined.includes('--stat')) return { status: 0, stdout: '2 files changed\n', stderr: '' }
        return { status: 0, stdout: 'diff --git a/src/a.mjs b/src/a.mjs\n', stderr: '' }
      }
    })

    expect(facts.changedPaths).toEqual(['src/a.mjs', 'README.md'])
    expect(facts.diffProfile).toEqual({
      kind: 'general',
      releaseEntryPaths: [],
      lockfilePaths: []
    })
    expect(facts.commits).toEqual(['abc123\tfix: useful'])
    expect(facts.diffStat).toBe('2 files changed')
    expect(facts.verification).toBe(
      'Behavioral LLM review завершено; acceptance підтверджують фінальні детерміновані Git, tests, lint і changelog gates.'
    )
    expect(calls.every(([command]) => command === 'git')).toBe(true)
  })

  test('PR description validation вимагає factual evidence та business/architecture emphasis', () => {
    const facts = { changedPaths: ['src/a.mjs'] }
    const valid = {
      businessContext:
        'Команда отримує передбачуваний reconcile flow без ручного переписування опису після перенесення змін.',
      businessOutcomes: ['Зменшується час review завдяки поясненню цінності зміни для команди.'],
      architectureChanges: [
        'Окремий narrative boundary перетворює фінальний Git diff на перевірений контракт опису PR.'
      ],
      behaviorChanges: ['PR відкривається лише після успішної валідації структурованого опису.'],
      risksAndCompatibility: ['Git cleanup і CI readiness залишаються без змін.'],
      evidencePaths: ['src/a.mjs']
    }

    expect(validatePullRequestDescription({ text: JSON.stringify(valid) }, facts)).toEqual({
      ok: true,
      value: valid
    })
    expect(
      validatePullRequestDescription({ text: JSON.stringify({ ...valid, evidencePaths: ['src/missing.mjs'] }) }, facts)
        .error
    ).toContain('changedPaths')
    expect(
      validatePullRequestDescription(
        {
          text: JSON.stringify({
            ...valid,
            businessContext: 'Підтверджений бізнес-контекст лишається навмисно стислим для цієї перевірки.',
            businessOutcomes: ['Короткий підтверджений результат для команди review.'],
            architectureChanges: ['Коротка підтверджена зміна architecture boundary.'],
            behaviorChanges: ['Дуже детальний опис поведінки '.repeat(12)],
            risksAndCompatibility: ['Дуже детальний опис ризиків і сумісності '.repeat(12)]
          })
        },
        facts
      ).error
    ).toContain('коротший')
  })

  test('PR body ставить business та architecture перед технічними доказами', () => {
    const description = {
      businessContext: 'Reconcile PR пояснює цінність зміни до переходу до технічних доказів.',
      businessOutcomes: ['Reviewer швидше розуміє очікуваний продуктово-операційний результат.'],
      architectureChanges: ['Narrative layer описує responsibilities і contracts фінального diff.'],
      behaviorChanges: ['PR отримує стабільний структурований опис.'],
      risksAndCompatibility: ['Наявний CI та cleanup contract не змінюються.'],
      evidencePaths: ['src/a.mjs']
    }
    const body = renderPullRequestBody({
      description,
      facts: {
        baseRef: 'origin/main',
        source: REVIEW_BRANCH.source,
        verification: verificationSummary('raw agent transcript with internal exploration')
      }
    })

    expect(body.indexOf('## Бізнес-результат')).toBeLessThan(body.indexOf('## Архітектура'))
    expect(body.indexOf('## Архітектура')).toBeLessThan(body.indexOf('## Поведінка'))
    expect(body).toContain('<summary>Технічні докази перенесення</summary>')
    expect(body).toContain('`src/a.mjs`')
    expect(body).not.toContain('raw agent transcript')
    expect(body).toContain('фінальні детерміновані Git, tests, lint і changelog gates')
  })

  test('verification summary окремо описує empty та no-code outcomes', () => {
    expect(verificationSummary('')).toBe('')
    expect(verificationSummary('Додатковий behavioral LLM не потрібен: code paths не змінено.')).toContain(
      'final diff не містить code paths'
    )
  })

  test('release entry + lockfile лишається PR, але narrative не приписує runtime-зміни', () => {
    const facts = {
      changedPaths: ['app/.changes/260723-0932.md', 'bun.lock'],
      diffProfile: pullRequestDiffProfile(['app/.changes/260723-0932.md', 'bun.lock'])
    }
    const candidate = {
      businessContext:
        'Change entry фіксує product intent постійно показувати правило для схожих листів у контексті сторінки.',
      businessOutcomes: ['Панель правила стає постійно видимою на сторінці листа.'],
      architectureChanges: ['Сторінка тепер безпосередньо володіє панеллю правила.'],
      behaviorChanges: ['Кнопка Rule більше не відкриває modal.'],
      risksAndCompatibility: ['Lockfile має лишатися відтворюваним після перенесення.'],
      evidencePaths: ['app/.changes/260723-0932.md', 'bun.lock']
    }

    const validated = validatePullRequestDescription({ text: JSON.stringify(candidate) }, facts)
    expect(validated.ok).toBe(true)
    expect(validated.value.businessOutcomes[0]).toContain('Product intent, зафіксований у change entry')
    expect(validated.value.architectureChanges).toEqual([
      'Фінальний diff не змінює runtime architecture: PR переносить release metadata та зафіксований dependency lock state.'
    ])
    expect(validated.value.behaviorChanges).toEqual([
      'Фінальний diff не додає runtime behavior; product outcome нижче є наміром, зафіксованим у change entry.'
    ])

    const body = renderPullRequestBody({
      description: validated.value,
      facts: { ...facts, baseRef: 'origin/main', source: REVIEW_BRANCH.source }
    })
    expect(body).toContain('Final diff цього PR містить лише release metadata та lockfile')
  })

  test('release-lock-only diff відсіює exact intent, уже опублікований у base CHANGELOG', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-release-'))
    mkdirSync(resolve(root, 'app/.changes'), { recursive: true })
    writeFileSync(
      resolve(root, 'app/.changes/260723-0932.md'),
      ['---', 'bump: patch', 'section: Changed', '---', 'Панель правила вже постійна частина сторінки.'].join('\n')
    )
    const profile = pullRequestDiffProfile(['app/.changes/260723-0932.md', 'bun.lock'])

    try {
      expect(
        releasedChangeEntries(root, 'origin/main', profile, (_command, args) => {
          expect(args).toEqual(['show', 'origin/main:app/CHANGELOG.md'])
          return {
            status: 0,
            stdout: '## [1.2.3]\n\n### Changed\n\n- Панель правила вже постійна частина сторінки.\n',
            stderr: ''
          }
        })
      ).toEqual(['app/.changes/260723-0932.md'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('released entries fail-closed для відсутнього CHANGELOG і порожнього narrative', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-release-empty-'))
    mkdirSync(resolve(root, '.changes'))
    writeFileSync(resolve(root, '.changes/empty.md'), '---\nbump: patch\n---\n')
    try {
      expect(
        releasedChangeEntries(
          root,
          'origin/main',
          { releaseEntryPaths: ['missing/.changes/entry.md', '.changes/empty.md'] },
          (_command, args) => ({
            status: args[1].includes('missing') ? 1 : 0,
            stdout: 'existing changelog',
            stderr: ''
          })
        )
      ).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('PR description використовує min→validation→max fallback', async () => {
    const tiers = []
    const valid = {
      businessContext: 'Команда отримує архітектурний і бізнесовий опис reconcile-зміни на основі фінального diff.',
      businessOutcomes: ['Reviewer бачить підтверджений operational outcome до implementation details.'],
      architectureChanges: ['Description boundary відокремлює factual Git context від Markdown rendering.'],
      behaviorChanges: ['PR отримує структурований body.'],
      risksAndCompatibility: ['Наявний cleanup flow залишається сумісним.'],
      evidencePaths: ['src/a.mjs']
    }
    const body = await describePullRequest({
      runner: 'codex',
      cwd: '/repo',
      baseRef: 'origin/main',
      source: REVIEW_BRANCH.source,
      title: 'fix: useful',
      rationale: 'готовий fix',
      verification: 'tests pass',
      spawnFn: () => ({ status: 0, stdout: '', stderr: '' }),
      log: noop,
      deps: {
        collectPullRequestFacts: args => ({ ...args, changedPaths: ['src/a.mjs'] }),
        callRunner: (_runner, _prompt, _cwd, _deps, tier) => {
          tiers.push(tier)
          return Promise.resolve({
            ok: true,
            text: tier === 'min' ? '{"businessContext":"invalid"}' : JSON.stringify(valid),
            error: null
          })
        }
      }
    })

    expect(tiers).toEqual(['min', 'max'])
    expect(body).toContain('## Архітектура')
  })
})

describe('triage validation', () => {
  test('приймає повний verdict і subset відомих commits', () => {
    const outcome = {
      text: JSON.stringify({
        decisions: [
          {
            source: REVIEW_BRANCH.source,
            intent: 'complete-useful',
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
            intent: 'complete-useful',
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
            intent: 'complete-useful',
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
            intent: 'complete-useful',
            action: 'pr',
            groups: [{ title: 'fix: one' }, { title: 'fix: two' }]
          }
        ]
      })
    }

    expect(validateTriageOutcome(repeatedCommit, [REVIEW_BRANCH]).error).toContain('повторюється')
    expect(validateTriageOutcome(splitStash, [stash]).error).toContain('неподільний stash')
  })

  test('intent/action contract не дозволяє keep завершеної корисної зміни через conflict', () => {
    const conflicted = { ...REVIEW_BRANCH, conflicts: ['src/a.mjs'] }
    const invalidKeep = {
      text: JSON.stringify({
        decisions: [
          {
            source: conflicted.source,
            intent: 'complete-useful',
            action: 'keep',
            rationale: 'корисний fix, але є conflict',
            groups: []
          }
        ]
      })
    }
    const validKeep = {
      text: JSON.stringify({
        decisions: [
          {
            source: conflicted.source,
            intent: 'uncertain',
            action: 'keep',
            rationale: 'не вистачає доказів завершеності',
            groups: []
          }
        ]
      })
    }

    expect(validateTriageOutcome(invalidKeep, [conflicted]).error).toContain('intent/action не узгоджені')
    expect(validateTriageOutcome(validKeep, [conflicted]).ok).toBe(true)
  })
})

describe('worktree validation', () => {
  test('change-only diff не породжує PR', () => {
    expect(hasOnlyChangeEntries(['owner/.changes/260713-0931.md', 'app/.changes/260715-1655.md'])).toBe(true)
    expect(hasOnlyChangeEntries(['owner/.changes/260713-0931.md', 'bun.lock'])).toBe(false)
    expect(hasOnlyChangeEntries(['owner/.changes/260713-0931.md', 'owner/src/lib.rs'])).toBe(false)
    expect(hasOnlyChangeEntries([])).toBe(false)
  })

  test('patch-equivalent guard прибирає no-op, change-only і вже опублікований release intent', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-discard-'))
    const worktree = { cwd: root, branch: 'codex/reconcile-fixture' }
    const progress = []
    mkdirSync(resolve(root, 'app/.changes'), { recursive: true })
    writeFileSync(
      resolve(root, 'app/.changes/released.md'),
      ['---', 'bump: patch', '---', 'Опублікована зміна поведінки.'].join('\n')
    )

    const runCase = paths =>
      discardPatchEquivalentWorktree({
        worktree,
        rootCwd: '/repo',
        onProgress: step => {
          progress.push(step)
        },
        spawnFn: (command, args) => {
          if (command === 'npx') return { status: 0, stdout: '', stderr: '' }
          if (args[0] === 'show') {
            return { status: 0, stdout: '### Fixed\n\n- Опублікована зміна поведінки.\n', stderr: '' }
          }
          if (args[0] === 'ls-files') return { status: 0, stdout: '', stderr: '' }
          if (args.includes('--name-only')) return { status: 0, stdout: `${paths.join('\n')}\n`, stderr: '' }
          if (args[0] === 'diff' && args.includes('--quiet')) {
            return { status: paths.length === 0 ? 0 : 1, stdout: '', stderr: '' }
          }
          return { status: 0, stdout: '', stderr: '' }
        }
      })

    try {
      expect(runCase([])).toEqual({ status: 'patch-equivalent', branch: worktree.branch })
      expect(runCase(['app/.changes/unreleased.md'])).toMatchObject({
        status: 'patch-equivalent',
        rationale: expect.stringContaining('тільки release entries')
      })
      expect(runCase(['app/.changes/released.md', 'bun.lock'])).toMatchObject({
        status: 'patch-equivalent',
        rationale: expect.stringContaining('base CHANGELOG')
      })
      expect(progress).toEqual([
        'remove no-op worktree',
        'remove change-only worktree',
        'remove already-released worktree'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('final bun.lock завжди проходить frozen validation навіть за наявного node_modules', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-lock-'))
    writeFileSync(resolve(root, 'package.json'), '{"name":"fixture"}')
    writeFileSync(resolve(root, 'bun.lock'), '{}')
    const commands = []

    try {
      const result = await validateChangedLockfiles(
        root,
        (_command, args) => {
          if (args[0] === 'diff') return { status: 0, stdout: 'bun.lock\n', stderr: '' }
          if (args[0] === 'ls-files') return { status: 0, stdout: '', stderr: '' }
          return { status: 0, stdout: '', stderr: '' }
        },
        (command, args) => {
          commands.push([command, args])
          return Promise.resolve({ status: 1, stdout: '', stderr: 'lockfile had changes' })
        }
      )

      expect(commands).toEqual([['bun', ['install', '--frozen-lockfile']]])
      expect(result).toMatchObject({
        ok: false,
        remediation: 'bun-lockfile'
      })
      expect(result.error).toContain('lockfile had changes')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('final gates синхронізують stale bun.lock один раз і перевіряють його повторно', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-final-lock-'))
    writeFileSync(resolve(root, 'package.json'), '{}\n')
    writeFileSync(resolve(root, 'bun.lock'), '')
    const commands = []
    let frozenAttempts = 0
    try {
      const result = await passFinalProjectGates({
        cwd: root,
        onProgress: step => {
          commands.push(['progress', step])
        },
        spawnFn: (_command, args) => {
          if (args[0] === 'diff') return { status: 0, stdout: 'bun.lock\n', stderr: '' }
          return { status: 0, stdout: '', stderr: '' }
        },
        asyncSpawnFn: (command, args) => {
          commands.push([command, ...args])
          if (command === 'bun' && args.includes('--frozen-lockfile')) {
            frozenAttempts += 1
            return Promise.resolve({
              status: frozenAttempts === 1 ? 1 : 0,
              stdout: '',
              stderr: frozenAttempts === 1 ? 'stale lock' : ''
            })
          }
          return Promise.resolve({ status: 0, stdout: '', stderr: '' })
        }
      })

      expect(result).toEqual({ ok: true })
      expect(commands).toContainEqual(['progress', 'synchronize final bun.lock'])
      expect(commands).toContainEqual(['bun', 'install', '--lockfile-only', '--ignore-scripts'])
      expect(frozenAttempts).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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

  test('після conflict resolution empty cherry-pick пропускається замість continue', () => {
    const calls = []
    const action = finishCherryPick('/repo', (_command, args) => {
      calls.push(args)
      return { status: 0, stdout: args[0] === 'rev-parse' ? 'oid\n' : '', stderr: '' }
    })

    expect(action).toBe('skipped')
    expect(calls).toContainEqual(['cherry-pick', '--skip'])
    expect(calls).not.toContainEqual(['cherry-pick', '--continue'])
  })

  test('tree-diff guard відхиляє commits ahead із нульовим фінальним diff', () => {
    const noOp = hasChangesFromBase('/repo', (_command, args) => {
      if (args[0] === 'ls-files') return { status: 0, stdout: '', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    })
    const changed = hasChangesFromBase('/repo', (_command, args) => {
      if (args[0] === 'diff' && args[1] === '--quiet' && args[2] === 'origin/main...HEAD') {
        return { status: 1, stdout: '', stderr: '' }
      }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(noOp).toBe(false)
    expect(changed).toBe(true)
  })

  test('test baseline кешується за origin/main OID', async () => {
    const cache = new Map()
    const calls = []
    const spawnFn = (command, args) => {
      calls.push([command, args])
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'base-oid\n', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }

    const first = await captureCachedBehaviorBaseline('/repo-without-package-json', cache, spawnFn)
    const second = await captureCachedBehaviorBaseline('/repo-without-package-json', cache, spawnFn)

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(calls.filter(([, args]) => args[0] === 'rev-parse')).toHaveLength(2)
  })

  test('приймає clean Git state, зелений test script і changelog gate', async () => {
    const calls = []
    const result = await validateBehaviorState(process.cwd(), (command, args) => {
      calls.push([command, args])
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toContainEqual(['bun', ['run', 'test']])
    expect(calls).toContainEqual(['npx', ['@7n/rules', 'lint', 'changelog', '--no-fix']])
  })

  test('test failure блокує min-результат до changelog gate', async () => {
    const calls = []
    const result = await validateBehaviorState(process.cwd(), (command, args) => {
      calls.push([command, args])
      if (command === 'bun') return { status: 1, stdout: '', stderr: 'regression' }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('regression')
    expect(calls.some(([command]) => command === 'npx')).toBe(false)
  })

  test('nested npx не успадковує package selector зовнішнього npm exec', async () => {
    const previous = env.npm_config_package
    env.npm_config_package = '/tmp/outer-package'
    let npxEnv
    try {
      const result = await validateBehaviorState('/repo-without-package-json', (command, _args, options) => {
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

  test('non-code paths групуються в domain directories', () => {
    const paths = changedNonCodeDirectories(NPM_ROOT, (_command, args) => {
      if (args[0] === 'diff') {
        return {
          status: 0,
          stdout:
            'package.json\nskills/git-reconcile/SKILL.md\nrules/release/main.mdc\nskills/git-reconcile/js/code.mjs\n',
          stderr: ''
        }
      }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(paths).toEqual(['rules/release', 'skills/git-reconcile'])

    const scopes = changedNonCodeScopes(NPM_ROOT, (_command, args) => {
      if (args[0] === 'diff') {
        return {
          status: 0,
          stdout: 'package.json\nskills/git-reconcile/SKILL.md\n',
          stderr: ''
        }
      }
      return { status: 0, stdout: '', stderr: '' }
    })
    expect(scopes).toEqual(['package.json', 'skills/git-reconcile'])
  })

  test('final gate запускає domain lint до changelog', async () => {
    const calls = []
    const result = await validateFinalProjectGates(NPM_ROOT, (command, args) => {
      calls.push([command, args])
      if (command === 'git' && args[0] === 'diff') {
        return { status: 0, stdout: 'skills/git-reconcile/SKILL.md\n', stderr: '' }
      }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      ['git', ['diff', '--name-only', 'origin/main', '--']],
      ['git', ['ls-files', '--others', '--exclude-standard']],
      ['npx', ['@7n/rules', 'lint', '--path', 'skills/git-reconcile', '--no-fix']],
      ['npx', ['@7n/rules', 'lint', 'changelog', '--no-fix']]
    ])
  })

  test('final gate повертає точний domain lint або changelog blocker', async () => {
    await expect(validateFinalProjectGates(NPM_ROOT, finalGateSpawn('domain'))).resolves.toEqual({
      ok: false,
      error: 'domain lint (skills/git-reconcile): domain failed',
      remediation: 'canonical-fixers',
      remediationScopes: ['skills/git-reconcile']
    })
    await expect(validateFinalProjectGates(NPM_ROOT, finalGateSpawn('changelog'))).resolves.toEqual({
      ok: false,
      error: 'changelog gate: changelog failed',
      remediation: 'canonical-fixers',
      remediationScopes: []
    })
  })

  test('canonical remediation запускає scoped fix і changelog fix', async () => {
    const calls = []
    const result = await remediateBehaviorState(
      NPM_ROOT,
      (command, args) => {
        calls.push([command, args])
        if (command === 'git' && args[0] === 'diff') {
          return { status: 0, stdout: 'skills/git-reconcile/js/orchestrate.mjs\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
      { remediation: 'canonical-fixers' }
    )

    expect(result).toEqual({ attempted: true, ok: true })
    expect(calls).toContainEqual(['npx', ['@7n/rules', 'lint', '--path', 'skills/git-reconcile/js']])
    expect(calls).toContainEqual(['npx', ['@7n/rules', 'lint', 'changelog']])
  })

  test('canonical remediation виправляє non-code domain без behavioral LLM', async () => {
    const calls = []
    const result = await remediateBehaviorState(
      NPM_ROOT,
      (command, args) => {
        calls.push([command, args])
        if (command === 'git' && args[0] === 'diff') {
          return { status: 0, stdout: 'skills/git-reconcile/SKILL.md\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
      { remediation: 'canonical-fixers' }
    )

    expect(result).toEqual({ attempted: true, ok: true })
    expect(calls).toContainEqual(['npx', ['@7n/rules', 'lint', '--path', 'skills/git-reconcile']])
  })

  test('canonical remediation не розширює scope поза failed gate', async () => {
    const calls = []
    await remediateBehaviorState(
      NPM_ROOT,
      (command, args) => {
        calls.push([command, args])
        if (command === 'git' && args[0] === 'diff') {
          return { status: 0, stdout: 'jobs/a/src/a.mjs\njobs/b/src/b.mjs\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
      { remediation: 'canonical-fixers', remediationScopes: ['jobs/a/src'] }
    )

    expect(calls).toContainEqual(['npx', ['@7n/rules', 'lint', '--path', 'jobs/a/src']])
    expect(calls).not.toContainEqual(['npx', ['@7n/rules', 'lint', '--path', 'jobs/b/src']])
  })
})

describe('progress і bounded concurrency', () => {
  test('local worktree exclude резолвить git-path відносно repository cwd', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'git-reconcile-exclude-'))
    const infoDir = resolve(root, '.git/info')
    mkdirSync(infoDir, { recursive: true })
    try {
      expect(ensureLocalWorktreeExclude(root, localExcludeGitPath)).toBe(true)
      expect(ensureLocalWorktreeExclude(root, localExcludeGitPath)).toBe(false)
      expect(readFileSync(resolve(infoDir, 'exclude'), 'utf8')).toBe('.worktrees/\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('progress snapshots не містять ANSI та показують heartbeat elapsed', () => {
    const logs = []
    let heartbeat
    let cleared = false
    let now = 0
    const progress = createPhaseProgress({
      total: 2,
      unitLabel: 'PR-груп',
      phase: '3/4 PR',
      log: line => {
        logs.push(line)
      },
      now: () => now,
      heartbeatMs: 30_000,
      setIntervalFn: callback => {
        heartbeat = callback
        return { unref: noop }
      },
      clearIntervalFn: () => {
        cleared = true
      }
    })

    progress.step('pr-1', '1/2 · source · behavior', 'min')
    now = 65_000
    heartbeat()
    progress.done('pr-1')
    progress.stop()

    expect(logs.some(line => line.includes('elapsed 65.0 s'))).toBe(true)
    expect(logs.some(line => line.includes('[██████████░░░░░░░░░░] 1/2 PR-груп'))).toBe(true)
    expect(logs.every(line => !line.includes(String.fromCodePoint(27)))).toBe(true)
    expect(cleared).toBe(true)
  })

  test('async child не блокує heartbeat довгої команди', async () => {
    const logs = []
    const progress = createPhaseProgress({
      total: 1,
      unitLabel: 'команд',
      phase: 'validation',
      log: line => {
        logs.push(line)
      },
      heartbeatMs: 10
    })
    progress.step('slow', 'slow test')
    const running = runAsync(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], process.cwd(), spawn)
    await delay(40)
    expect(logs.some(line => line.startsWith('💓'))).toBe(true)
    await running
    progress.done('slow')
    progress.stop()
  })

  test('PR concurrency нормалізується до bounded 1..4', () => {
    expect(normalizePrConcurrency()).toBe(3)
    expect(normalizePrConcurrency(0)).toBe(1)
    expect(normalizePrConcurrency(8)).toBe(4)
    expect(normalizePrConcurrency(2)).toBe(2)
  })

  test('runWithConcurrency запускає незалежні jobs паралельно і зберігає порядок', async () => {
    const started = []
    const { promise: first, resolve: releaseFirst } = Promise.withResolvers()
    const { promise: second, resolve: releaseSecond } = Promise.withResolvers()
    const running = runWithConcurrency(
      [
        async () => {
          started.push(1)
          await first
          return 'one'
        },
        async () => {
          started.push(2)
          await second
          return 'two'
        },
        () => {
          started.push(3)
          return Promise.resolve('three')
        }
      ],
      2
    )

    await Promise.resolve()
    expect(started).toEqual([1, 2])
    releaseSecond()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual([1, 2, 3])
    releaseFirst()
    await expect(running).resolves.toEqual(['one', 'two', 'three'])
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
                  intent: 'complete-useful',
                  action: 'pr',
                  rationale: 'готовий fix',
                  groups: [{ title: 'fix: useful', commits: ['abc123'] }]
                },
                {
                  source: 'stash:stash@{0}',
                  intent: 'obsolete',
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
    expect(logs).toContain('⏳ етап 1/4: inventory')
    expect(logs.some(line => line.startsWith('✅ етап 1/4: inventory · 0 ms'))).toBe(true)
    expect(logs.some(line => line.includes('етап 2/4: triage · 1-2/2 · min'))).toBe(true)
    expect(logs.some(line => line.includes('1/1 triage-пакетів'))).toBe(true)
    expect(logs.some(line => line.includes(`етап 3/4: PR · 1/1 · ${REVIEW_BRANCH.source} · worktree`))).toBe(true)
    expect(logs.some(line => line.includes('етап 4/4: cleanup · stash:stash@{0}'))).toBe(true)
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
                  intent: 'complete-useful',
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

  test('непідтверджені PR checks блокують cleanup і загальний success', async () => {
    const cleanupCalls = []
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        cleanupSource: candidate => {
          cleanupCalls.push(candidate.source)
          return { status: 'removed' }
        },
        callRunner: () =>
          Promise.resolve({
            ok: true,
            error: null,
            text: JSON.stringify({
              decisions: [
                {
                  source: REVIEW_BRANCH.source,
                  intent: 'complete-useful',
                  action: 'pr',
                  rationale: 'готовий fix',
                  groups: [{ title: 'fix: useful', commits: ['abc123'] }]
                }
              ]
            })
          }),
        createPullRequest: () =>
          Promise.resolve({
            status: 'pr-checks-regressed',
            branch: 'codex/reconcile-useful',
            url: 'https://example.test/pr/1',
            worktree: '/repo/.worktrees/reconcile-useful',
            error: 'new failed check'
          })
      }
    })

    expect(result.ok).toBe(false)
    expect(result.results[0].status).toBe('pr-checks-regressed')
    expect(result.results[0].worktree).toBe('/repo/.worktrees/reconcile-useful')
    expect(cleanupCalls).toEqual(['branch:refs/remotes/origin/already-merged'])
  })

  test('відсутній native mt fail-closed лишає source та повертає spawnSync ENOENT', async () => {
    const cleanupCalls = []
    const worktreeName = 'reconcile-fix-jwt-bridge-workspace-dockerfile-and'
    const branch = `mt/${worktreeName}`
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        cleanupSource: candidate => {
          cleanupCalls.push(candidate.source)
          return { status: 'removed' }
        },
        callRunner: () =>
          Promise.resolve({
            ok: true,
            error: null,
            text: JSON.stringify({
              decisions: [
                {
                  source: REVIEW_BRANCH.source,
                  intent: 'complete-useful',
                  action: 'pr',
                  groups: [{ title: 'Fix JWT bridge workspace Dockerfile and trailing separator', commits: ['abc123'] }]
                }
              ]
            })
          }),
        spawnFn: (command, args, options) => {
          if (command === 'git' && args[0] === 'show-ref') return { status: 1, stdout: '', stderr: '' }
          if (command === 'git' && args[0] === 'ls-remote') return { status: 1, stdout: '', stderr: '' }
          if (command === 'git' && args[0] === 'worktree') {
            return {
              status: 0,
              stdout: ['worktree /repo', 'HEAD base', 'branch refs/heads/main', ''].join('\n'),
              stderr: ''
            }
          }
          if (command === 'mt') {
            expect(options.cwd).toBe('/repo')
            expect(options.env.PATH).not.toContain('node_modules/.bin')
            return {
              status: null,
              stdout: '',
              stderr: '',
              error: Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' })
            }
          }
          return { status: 0, stdout: '', stderr: '' }
        }
      }
    })

    expect(result.ok).toBe(false)
    expect(result.results[0]).toMatchObject({
      source: REVIEW_BRANCH.source,
      status: 'failed',
      branch,
      worktree: undefined
    })
    expect(result.results[0].error).toContain('ENOENT')
    expect(cleanupCalls).not.toContain(REVIEW_BRANCH.source)
  })

  test('несумісний mt create JSON прибирає щойно створений legacy worktree і branch', async () => {
    const cleanupCalls = []
    const gitCleanupCalls = []
    const worktreeName = 'reconcile-fix-jwt-bridge-workspace-dockerfile-and'
    const expectedBranch = `mt/${worktreeName}`
    const legacyBranch = worktreeName
    const actualWorktree = `/repo/.worktrees/${worktreeName}`
    let partialExists = false
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        cleanupSource: candidate => {
          cleanupCalls.push(candidate.source)
          return { status: 'removed' }
        },
        callRunner: () =>
          Promise.resolve({
            ok: true,
            error: null,
            text: JSON.stringify({
              decisions: [
                {
                  source: REVIEW_BRANCH.source,
                  intent: 'complete-useful',
                  action: 'pr',
                  rationale: 'готовий fix',
                  groups: [{ title: 'Fix JWT bridge workspace Dockerfile and trailing separator', commits: ['abc123'] }]
                }
              ]
            })
          }),
        spawnFn: (command, args) => {
          if (command === 'git' && args[0] === 'show-ref') return { status: 1, stdout: '', stderr: '' }
          if (command === 'git' && args[0] === 'ls-remote') return { status: 1, stdout: '', stderr: '' }
          if (command === 'git' && args[0] === 'worktree' && args[1] === 'list') {
            const partial = partialExists
              ? [`worktree ${actualWorktree}`, 'HEAD base', `branch refs/heads/${legacyBranch}`, '']
              : []
            return {
              status: 0,
              stdout: ['worktree /repo', 'HEAD base', 'branch refs/heads/main', '', ...partial].join('\n'),
              stderr: ''
            }
          }
          if (command === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
            gitCleanupCalls.push([command, args])
            partialExists = false
            return { status: 0, stdout: '', stderr: '' }
          }
          if (command === 'git' && args[0] === 'branch' && args[1] === '-D') {
            gitCleanupCalls.push([command, args])
            return { status: 0, stdout: '', stderr: '' }
          }
          if (command === 'git' && args[0] === 'worktree' && args[1] === 'prune') {
            return { status: 0, stdout: '', stderr: '' }
          }
          if (command === 'mt' && args.includes('--help')) {
            return {
              status: 0,
              stdout: 'mt/<name> --base --description --json',
              stderr: ''
            }
          }
          if (command === 'mt' && args.includes('create')) {
            partialExists = true
            return {
              status: 0,
              stdout: `✓ worktree створено: ${actualWorktree}`,
              stderr: ''
            }
          }
          return { status: 0, stdout: '', stderr: '' }
        }
      }
    })

    expect(result.ok).toBe(false)
    expect(result.results[0]).toMatchObject({
      source: REVIEW_BRANCH.source,
      status: 'failed',
      branch: expectedBranch,
      worktree: undefined
    })
    expect(result.results[0].error).toContain('несумісний create JSON')
    expect(gitCleanupCalls).toEqual([
      ['git', ['worktree', 'remove', '--force', actualWorktree]],
      ['git', ['branch', '-D', legacyBranch]]
    ])
    expect(partialExists).toBe(false)
    expect(cleanupCalls).not.toContain(REVIEW_BRANCH.source)
  })

  test('semantic patch-equivalent group не створює cleanup blocker', async () => {
    const cleaned = []
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () => inventory({ stashes: [] }),
        cleanupSource: candidate => {
          cleaned.push(candidate.source)
          return { status: 'removed' }
        },
        callRunner: () =>
          Promise.resolve({
            ok: true,
            error: null,
            text: JSON.stringify({
              decisions: [
                {
                  source: REVIEW_BRANCH.source,
                  intent: 'complete-useful',
                  action: 'pr',
                  groups: [{ title: 'fix: already integrated', commits: ['abc123'] }]
                }
              ]
            })
          }),
        createPullRequest: () =>
          Promise.resolve({
            status: 'patch-equivalent',
            branch: 'codex/reconcile-already-integrated'
          })
      }
    })

    expect(result.ok).toBe(true)
    expect(result.results[0].status).toBe('patch-equivalent')
    expect(cleaned).toContain(REVIEW_BRANCH.source)
  })

  test('Git-доведений patch-equivalent stash не йде в LLM і прибирається за stable OID', async () => {
    const cleaned = []
    const result = await runGitReconcileOrchestrator({
      cwd: '/repo',
      log: noop,
      deps: {
        inventoryRepository: () =>
          inventory({
            branches: [],
            stashes: [
              {
                source: 'stash:stash@{3}',
                ref: 'stash@{3}',
                oid: 'stash-oid',
                state: 'patch-equivalent',
                equivalence: 'absorbed-in-base',
                changedFiles: ['M\tsrc/absorbed.mjs']
              }
            ]
          }),
        cleanupSource: candidate => {
          cleaned.push(candidate.oid)
          return { status: 'removed', removedRefs: [candidate.ref] }
        },
        callRunner: () => {
          throw new Error('LLM не має викликатися')
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(cleaned).toEqual(['stash-oid'])
    expect(result.report).toContain('Remaining: branches=0, worktrees=0, stashes=0')
    expect(result.report).toContain('absorbed-in-base')
  })
})

describe('cleanupSource', () => {
  test('cleanup worktree прибирає stale record і clean merged transient checkout, але зберігає dirty та unique', () => {
    const calls = []
    const merged = {
      source: 'branch:refs/heads/merged',
      ref: 'refs/heads/merged',
      oid: 'merged-oid',
      state: 'merged',
      worktree: '/repo/.worktrees/merged'
    }
    const openPullRequest = {
      source: 'branch:refs/heads/open-pr',
      ref: 'refs/heads/open-pr',
      oid: 'open-pr-oid',
      state: 'open-pr',
      worktree: '/repo/.worktrees/open-pr',
      pr: { url: 'https://example.test/pr/7' }
    }
    const state = inventory({
      base: 'origin/main',
      branches: [merged, openPullRequest],
      worktrees: [
        {
          path: '/private/tmp/stale',
          head: 'stale',
          prunable: true,
          current: false,
          locked: false,
          protected: false,
          dirty: null,
          managed: false
        },
        {
          path: '/repo/.worktrees/merged',
          head: 'merged-oid',
          branch: 'refs/heads/merged',
          prunable: false,
          current: false,
          locked: false,
          protected: false,
          dirty: false,
          managed: true
        },
        {
          path: '/repo/.worktrees/dirty',
          head: 'merged-oid',
          branch: 'refs/heads/dirty',
          prunable: false,
          current: false,
          locked: false,
          protected: false,
          dirty: true,
          managed: true
        },
        {
          path: '/repo/.worktrees/open-pr',
          head: 'open-pr-oid',
          branch: 'refs/heads/open-pr',
          prunable: false,
          current: false,
          locked: false,
          protected: false,
          dirty: false,
          managed: true
        },
        {
          path: '/repo/.claude/worktrees/unique',
          head: 'unique-oid',
          branch: null,
          prunable: false,
          current: false,
          locked: false,
          protected: false,
          dirty: false,
          managed: true
        }
      ]
    })

    const outcomes = cleanupObsoleteWorktrees(state, '/repo', (command, args) => {
      calls.push([command, args])
      if (command === 'git' && args[0] === 'merge-base') {
        return { status: args[2] === 'merged-oid' ? 0 : 1, stdout: '', stderr: '' }
      }
      return { status: 0, stdout: '', stderr: '' }
    })

    expect(outcomes).toEqual([
      { path: '/private/tmp/stale', status: 'pruned' },
      { path: '/repo/.worktrees/merged', status: 'removed' }
    ])
    expect(calls).toContainEqual(['git', ['worktree', 'prune']])
    expect(calls).toContainEqual(['npx', ['@7n/mt', 'worktree', 'remove', 'merged']])
    expect(calls).not.toContainEqual(['npx', ['@7n/mt', 'worktree', 'remove', 'open-pr']])
    expect(calls).not.toContainEqual(['git', ['worktree', 'remove', '/repo/.claude/worktrees/unique']])
    expect(merged.worktree).toBeNull()
  })

  test('cleanup fail-closed зберігає stale, warning-protected і failed transient worktree', () => {
    const stale = {
      path: '/private/tmp/stale',
      head: 'stale',
      prunable: true,
      current: false,
      locked: false,
      protected: false,
      dirty: null,
      managed: false
    }
    expect(
      cleanupObsoleteWorktrees(
        inventory({ worktrees: [stale], warnings: ['GitHub inventory unavailable'] }),
        '/repo',
        () => ({ status: 1, stdout: '', stderr: 'prune failed' })
      )
    ).toEqual([{ path: stale.path, status: 'cleanup-failed', error: 'prune failed' }])

    const detached = {
      path: '/repo/.claude/worktrees/merged',
      head: 'merged-oid',
      branch: null,
      prunable: false,
      current: false,
      locked: false,
      protected: false,
      dirty: false,
      managed: true
    }
    expect(
      cleanupObsoleteWorktrees(inventory({ worktrees: [detached], branches: [] }), '/repo', (_command, args) => {
        if (args[0] === 'merge-base') return { status: 0, stdout: '', stderr: '' }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return { status: 1, stdout: '', stderr: 'remove failed' }
        }
        return { status: 0, stdout: '', stderr: '' }
      })
    ).toEqual([{ path: detached.path, status: 'cleanup-failed', error: 'remove failed' }])
  })

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

    expect(result).toEqual({
      status: 'removed',
      removedRefs: ['refs/heads/feature/a', 'refs/remotes/origin/feature/a']
    })
    expect(calls).toEqual([
      ['git', ['show-ref', '--verify', '--quiet', 'refs/heads/feature/a']],
      ['git', ['branch', '-D', 'feature/a']],
      ['git', ['ls-remote', '--exit-code', '--heads', 'origin', 'feature/a']],
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

    expect(result).toEqual({ status: 'removed', removedRefs: ['stash@{1}'] })
    expect(calls.at(-1)).toEqual(['git', ['stash', 'drop', 'stash@{1}']])
  })

  test('cleanupSource безпечно приймає вже відсутні refs і повертає command failure', () => {
    expect(
      cleanupSource({ source: 'stash:stash@{4}', oid: 'missing' }, '/repo', () => ({
        status: 0,
        stdout: '',
        stderr: ''
      }))
    ).toEqual({ status: 'already-removed', removedRefs: [] })

    expect(
      cleanupSource(
        {
          source: REVIEW_BRANCH.source,
          aliases: ['refs/heads/missing', 'refs/remotes/origin/missing']
        },
        '/repo',
        () => ({ status: 1, stdout: '', stderr: '' })
      )
    ).toEqual({ status: 'removed', removedRefs: [] })

    expect(
      cleanupSource({ source: 'stash:stash@{4}', oid: 'broken' }, '/repo', () => {
        throw new Error('Git unavailable')
      })
    ).toEqual({ status: 'cleanup-failed', error: 'Git unavailable' })
  })
})

describe('report helpers', () => {
  test('branchSlug обмежує ref до безпечного короткого slug', () => {
    expect(branchSlug('Fix: Привіт / API!!!')).toBe('fix-api')
    expect(branchSlug('***')).toBe('change')
    expect(branchSlug('a'.repeat(39) + '!')).toBe('a'.repeat(39))
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
        worktreeCleanup: [{ path: '/repo/.worktrees/stale', status: 'cleanup-failed', error: 'locked' }],
        warnings: ['gh недоступний']
      }),
      results: [
        {
          source: 'branch:feature/a',
          status: 'patch-equivalent',
          cleanup: { status: 'removed', removedRefs: ['refs/heads/feature/a'] }
        }
      ]
    })

    expect(report).toContain('`merged`: merged')
    expect(report).toContain('cleanup=removed; oid=merged-oid')
    expect(report).toContain('/repo/.worktrees/protected')
    expect(report).toContain('https://example.test/pr/2')
    expect(report).toContain('gh недоступний')
    expect(report).toContain('worktree `/repo/.worktrees/stale`: cleanup-failed — locked')
    expect(report).toContain('refs=`refs/heads/feature/a`')
    expect(report).toContain('Remaining: branches=2, worktrees=0, stashes=0')
  })

  test('remaining summary рахує фактичний залишок і причини retention', () => {
    const summary = summarizeRemaining({
      inventory: inventory({
        branches: [
          {
            source: 'branch:dirty',
            state: 'merged',
            worktree: '/repo/.worktrees/dirty'
          },
          { source: 'branch:kept', state: 'review' },
          { source: 'branch:removed', state: 'merged', cleanup: { status: 'removed' } }
        ],
        stashes: [
          { source: 'stash:kept', state: 'review' },
          { source: 'stash:removed', state: 'patch-equivalent', cleanup: { status: 'removed' } }
        ],
        worktrees: [
          { path: '/repo', current: true, dirty: true },
          { path: '/repo/.worktrees/dirty', current: false, dirty: true },
          { path: '/repo/.worktrees/removed', current: false, dirty: false }
        ],
        worktreeCleanup: [{ path: '/repo/.worktrees/removed', status: 'removed' }]
      }),
      results: [
        {
          source: 'branch:kept',
          status: 'failed',
          branch: 'codex/recovered',
          worktree: '/repo/.worktrees/recovered'
        },
        { source: 'stash:kept', status: 'kept' }
      ]
    })

    expect(summary).toEqual({
      branches: 3,
      stashes: 1,
      worktrees: 3,
      sourceReasons: 'dirty-worktree=1, failed=2, kept=1',
      worktreeReasons: 'current=1, dirty=1, failed=1'
    })
  })

  test('report деталізує збережений worktree, причину і наступну дію', () => {
    const report = formatReport({
      inventory: inventory({ branches: [], stashes: [], worktrees: [] }),
      results: [
        {
          source: 'branch:feature/transfer',
          status: 'failed',
          error: "Нерозв'язані конфлікти: package.json",
          branch: 'mt/reconcile-transfer',
          worktree: '/repo/.worktrees/reconcile-transfer',
          retention: {
            commitsAhead: 1,
            unresolvedPaths: ['package.json'],
            stagedPaths: ['package.json'],
            unstagedPaths: []
          }
        }
      ]
    })

    expect(report).toContain('### Залишено для ручного продовження')
    expect(report).toContain('source=`branch:feature/transfer`; status=failed')
    expect(report).toContain("reason: Нерозв'язані конфлікти: package.json")
    expect(report).toContain('commits ahead of base: 1')
    expect(report).toContain('unresolved paths: package.json')
    expect(report).toContain('next action: Розв’язати перелічені конфлікти')
  })

  test('успішний PR без forensic worktree не рахує видалену mt-гілку як remaining', () => {
    expect(
      summarizeRemaining({
        inventory: inventory({ branches: [], stashes: [], worktrees: [] }),
        results: [{ source: REVIEW_BRANCH.source, status: 'pr-created', branch: 'mt/reconcile-useful' }]
      })
    ).toMatchObject({ branches: 0, worktrees: 0, stashes: 0, sourceReasons: '', worktreeReasons: '' })
  })

  test('PR checks називають regression лише проти green base check', () => {
    expect(classifyPullRequestChecks([], []).status).toBe('pr-checks-unverified')
    expect(classifyPullRequestChecks([{ name: 'test', conclusion: 'SUCCESS' }], [])).toEqual({ status: 'ready' })
    expect(
      classifyPullRequestChecks([{ name: 'test', conclusion: 'FAILURE' }], [{ name: 'test', conclusion: 'FAILURE' }])
        .status
    ).toBe('pr-checks-baseline-red')
    expect(classifyPullRequestChecks([{ name: 'test', conclusion: 'FAILURE' }], []).status).toBe('pr-checks-unverified')
    expect(
      classifyPullRequestChecks([{ name: 'test', conclusion: 'FAILURE' }], [{ name: 'test', conclusion: 'SUCCESS' }])
        .status
    ).toBe('pr-checks-regressed')
    expect(classifyPullRequestChecks([{ name: 'test', status: 'IN_PROGRESS' }], []).status).toBe('pr-checks-unverified')
  })

  test('outcome counters точні й deterministic', () => {
    expect(
      formatOutcomeCounts([
        { status: 'pr-created' },
        { status: 'kept' },
        { status: 'pr-created' },
        { status: 'pr-checks-unverified' }
      ])
    ).toBe('kept=1, pr-checks-unverified=1, pr-created=2')
  })
})
