/** @see ./docs/orchestrate.md */
// cspell:ignore lockfiles treeish
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { env } from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

import { renderProgressLine } from '../../../scripts/lib/lint-surface/progress.mjs'
import { readGitPolicy } from '../../../scripts/lib/git-policy.mjs'

const LLM_TIERS = ['min', 'max']
const REVIEW_BATCH_SIZE = 10
const PROMPT_TEXT_LIMIT = 12_000
const PR_DIFF_TEXT_LIMIT = 24_000
const PROGRESS_HEARTBEAT_MS = 30_000
const PR_CHECK_TIMEOUT_MS = 15 * 60_000
const DEFAULT_PR_CONCURRENCY = 3
const MAX_PR_CONCURRENCY = 4
const STASH_PATH_LIMIT = 500
const SOURCE_BRANCH_PREFIX = 'branch:'
const SOURCE_STASH_PREFIX = 'stash:'
const CONTENT_CONFLICT_RE = /^CONFLICT \(.+?\): Merge conflict in (.+)$/
const MODIFY_DELETE_CONFLICT_RE = /^CONFLICT \(modify\/delete\): (.+?) deleted in /
const REF_HEADS_RE = /^refs\/heads\//
const REF_ORIGIN_RE = /^refs\/remotes\/origin\//
const RENAME_DELETE_CONFLICT_RE = /^CONFLICT \(rename\/delete\): .+? renamed to (.+?) in .+?, but deleted/
const SOURCE_CODE_RE = /\.(?:js|mjs|ts|vue|rs|py)$/
const CHANGE_ENTRY_RE = /(^|\/)\.changes\/[^/]+\.md$/
const LOCKFILE_RE =
  /(^|\/)(?:bun\.lockb?|Cargo\.lock|package-lock\.json|pnpm-lock\.yaml|poetry\.lock|uv\.lock|yarn\.lock)$/
const LEADING_MARKDOWN_BULLET_RE = /^-\s+/
const WHITESPACE_RE = /\s+/
const PR_DESCRIPTION_ARRAY_FIELDS = [
  'businessOutcomes',
  'architectureChanges',
  'behaviorChanges',
  'risksAndCompatibility'
]
const NO_CODE_VERIFICATION = 'Додатковий behavioral LLM не потрібен: code paths не змінено.'
const ACP_PROGRESS_ENV = 'N_LLM_ACP_PROGRESS'
const REF_INVENTORY_FORMAT = [
  '%(refname)',
  '%00',
  '%(object',
  'name)',
  '%00',
  '%(committer',
  'date:iso-strict)',
  '%00',
  '%(upstream)'
].join('')

/** @typedef {(command:string,args:string[],options:object)=>object|Promise<object>} CommandRunner */

const RELEASE_LOCK_ARCHITECTURE = [
  'Фінальний diff не змінює runtime architecture: PR переносить release metadata та зафіксований dependency lock state.'
]
const RELEASE_LOCK_BEHAVIOR = [
  'Фінальний diff не додає runtime behavior; product outcome нижче є наміром, зафіксованим у change entry.'
]

/** Порожній callback для опційного progress log. */
function noop() {
  // Навмисно порожньо: caller не запросив progress output.
}

/**
 * Форматує spawn error без вкладених template literals.
 * @param {object|undefined|null} error process error
 * @returns {string} діагностика
 */
function formatProcessError(error) {
  if (!error) return ''
  const code = error.code ? ` ${error.code}` : ''
  return `${error.name ?? 'Error'}${code}: ${error.message}`
}

/**
 * @param {string} cwd корінь репозиторію
 * @returns {string} remote ref базової гілки
 */
function policyBaseRef(cwd) {
  return `origin/${readGitPolicy(cwd).baseBranch}`
}

/**
 * Форматує elapsed time без удаваної точності.
 * @param {number} startedAt початок у мілісекундах
 * @param {() => number} now монотонне джерело часу
 * @returns {string} коротка тривалість
 */
function elapsedLabel(startedAt, now) {
  const elapsed = Math.max(0, now() - startedAt)
  return elapsed < 1000 ? `${Math.round(elapsed)} ms` : `${(elapsed / 1000).toFixed(1)} s`
}

/**
 * Створює ANSI-free snapshot progress для однієї фази. Однаковий append-only
 * формат у TTY/CI не засмічує captured output cursor-control кодами, а
 * heartbeat показує elapsed time довгих LLM-етапів.
 * @param {object} args параметри фази
 * @returns {{step:(key:string,detail:string,tier?:string)=>void,done:(key:string)=>void,stop:()=>void}} reporter
 */
export function createPhaseProgress(args) {
  const {
    total,
    unitLabel,
    phase,
    log,
    now = () => performance.now(),
    heartbeatMs = PROGRESS_HEARTBEAT_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = args
  if (total === 0) return { step: noop, done: noop, stop: noop }

  const active = new Map()
  const completed = new Set()

  /**
   * Рендерить один append-only snapshot без керувальних ANSI-послідовностей.
   * @param {string} prefix статус
   * @param {string} current поточний етап
   * @param {number|null} startedAt початок активної одиниці
   */
  function render(prefix, current, startedAt = null) {
    const elapsed = startedAt === null ? '' : ` · elapsed ${elapsedLabel(startedAt, now)}`
    log(
      `${prefix} ${renderProgressLine({
        done: completed.size,
        total,
        found: 0,
        fixed: 0,
        current,
        unitLabel,
        withFixed: false
      })}${elapsed}`
    )
  }

  const heartbeat = setIntervalFn(() => {
    if (active.size === 0) return
    const labels = active
      .values()
      .map(item => item.label)
      .toArray()
      .join(' | ')
    const oldest = Math.min(...active.values().map(item => item.startedAt))
    render('💓', labels, oldest)
  }, heartbeatMs)
  heartbeat?.unref?.()

  return {
    step: (key, detail, tier) => {
      const label = `${phase} · ${detail}`
      const rendered = tier ? `${label} · ${tier}` : label
      const previous = active.get(key)
      const startedAt = previous?.startedAt ?? now()
      if (previous?.label === rendered) return
      active.set(key, { label: rendered, startedAt })
      render('⏳', rendered, startedAt)
    },
    done: key => {
      if (completed.has(key)) return
      const current = active.get(key)?.label ?? `${phase} · ${key}`
      active.delete(key)
      completed.add(key)
      render('✅', current)
    },
    stop: () => {
      clearIntervalFn(heartbeat)
    }
  }
}

/**
 * Виконує команду без shell-інтерполяції.
 * @param {string} command виконуваний файл
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {typeof spawnSync} spawnFn інжект для тестів
 * @param {{ allowFailure?: boolean, input?: string }} [options] режим помилки та stdin
 * @returns {{ status: number, stdout: string, stderr: string, error: string }} результат
 */
function run(command, args, cwd, spawnFn, options = {}) {
  const childEnv = { ...env, GIT_EDITOR: 'true' }
  if (command === 'npx') delete childEnv.npm_config_package
  const result = spawnFn(command, args, {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: childEnv,
    maxBuffer: 16 * 1024 * 1024
  })
  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: formatProcessError(result.error)
  }
  if (!options.allowFailure && normalized.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} → exit ${normalized.status}: ${normalized.stderr || normalized.stdout || normalized.error}`
    )
  }
  return normalized
}

/**
 * Виконує довгу команду без блокування event loop, щоб progress heartbeat
 * продовжував працювати під час install/test/lint/PR checks. Інжектований
 * sync runner у unit tests також підтримується.
 * @param {string} command виконуваний файл
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {CommandRunner} spawnFn async або sync runner
 * @param {{ allowFailure?: boolean, input?: string, timeoutMs?: number }} [options] режим
 * @returns {Promise<{status:number,stdout:string,stderr:string,error:string}>} результат
 */
export async function runAsync(command, args, cwd, spawnFn, options = {}) {
  const childEnv = { ...env, GIT_EDITOR: 'true' }
  if (command === 'npx') delete childEnv.npm_config_package
  const spawned = spawnFn(command, args, {
    cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (!spawned || typeof spawned.on !== 'function') {
    const result = await spawned
    const normalized = {
      status: result?.status ?? 1,
      stdout: result?.stdout ?? '',
      stderr: result?.stderr ?? '',
      error: formatProcessError(result?.error)
    }
    if (!options.allowFailure && normalized.status !== 0) {
      throw new Error(
        `${command} ${args.join(' ')} → exit ${normalized.status}: ${normalized.stderr || normalized.stdout || normalized.error}`
      )
    }
    return normalized
  }

  const stdout = []
  const stderr = []
  let processError = ''
  let timedOut = false
  spawned.stdout?.setEncoding?.('utf8')
  spawned.stderr?.setEncoding?.('utf8')
  spawned.stdout?.on('data', chunk => {
    stdout.push(chunk)
  })
  spawned.stderr?.on('data', chunk => {
    stderr.push(chunk)
  })
  spawned.on('error', error => {
    processError = formatProcessError(error)
  })
  if (options.input === undefined) spawned.stdin?.end()
  else spawned.stdin?.end(options.input)

  const timer =
    options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          spawned.kill('SIGTERM')
        }, options.timeoutMs)
      : null
  timer?.unref?.()
  let status
  try {
    const [exitCode] = await once(spawned, 'close')
    status = exitCode ?? 1
  } catch {
    status = 1
  }
  if (timer) clearTimeout(timer)
  const normalized = {
    status,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    error: timedOut ? `Timeout after ${options.timeoutMs}ms` : processError
  }
  if (!options.allowFailure && normalized.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} → exit ${normalized.status}: ${normalized.stderr || normalized.stdout || normalized.error}`
    )
  }
  return normalized
}

/**
 * Production використовує non-blocking spawn, а існуючі sync test doubles
 * лишаються єдиним джерелом детермінованих результатів.
 * @param {CommandRunner} spawnFn sync runner
 * @param {CommandRunner|null|undefined} asyncSpawnFn явний async runner
 * @returns {CommandRunner} runner довгих команд
 */
function resolveAsyncSpawn(spawnFn, asyncSpawnFn) {
  return asyncSpawnFn ?? (spawnFn === spawnSync ? spawn : spawnFn)
}

/**
 * Запускає git у конкретному checkout.
 * @param {string[]} args аргументи git
 * @param {string} cwd checkout
 * @param {typeof spawnSync} spawnFn інжект
 * @param {{ allowFailure?: boolean, input?: string }} [options] режим
 * @returns {{ status: number, stdout: string, stderr: string }} результат
 */
function git(args, cwd, spawnFn, options) {
  return run('git', args, cwd, spawnFn, options)
}

/**
 * Розбирає JSON без падіння оркестратора.
 * @param {string} text JSON-текст
 * @param {unknown} fallback fallback
 * @returns {unknown} розібране значення або fallback
 */
function parseJson(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/**
 * Парсить branch refs, checkout HEAD OID і повні worktree records.
 * @param {string} text porcelain
 * @returns {{branches:Map<string,string>,commits:Map<string,string>,entries:Array<object>}} захищені checkout
 */
function parseWorktreeState(text) {
  const branches = new Map()
  const commits = new Map()
  const entries = []
  let entry = null
  const flush = () => {
    if (!entry) return
    entries.push(entry)
    entry = null
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      entry = {
        path: line.slice('worktree '.length),
        head: '',
        branch: null,
        detached: false,
        prunable: false,
        locked: false
      }
      continue
    }
    if (!entry) continue
    if (line.startsWith('HEAD ')) {
      entry.head = line.slice('HEAD '.length)
      commits.set(entry.head, entry.path)
    } else if (line.startsWith('branch ')) {
      entry.branch = line.slice('branch '.length)
      branches.set(entry.branch, entry.path)
    } else if (line === 'detached') {
      entry.detached = true
    } else if (line.startsWith('prunable ')) {
      entry.prunable = true
    } else if (line === 'locked' || line.startsWith('locked ')) {
      entry.locked = true
    } else if (line.length === 0) {
      flush()
    }
  }
  flush()
  return { branches, commits, entries }
}

/**
 * Повертає повні worktree records для deterministic cleanup policy.
 * @param {string} text porcelain
 * @returns {Array<object>} records
 */
export function parseWorktreeInventory(text) {
  return parseWorktreeState(text).entries
}

/**
 * Парсить `git worktree list --porcelain` у branch→path.
 * @param {string} text porcelain
 * @returns {Map<string, string>} повний ref гілки → checkout
 */
export function parseWorktrees(text) {
  return parseWorktreeState(text).branches
}

/**
 * Обмежує automatic cleanup лише transient worktree namespaces.
 * @param {string} path абсолютний worktree path
 * @returns {boolean} чи шлях належить керованому transient namespace
 */
function isManagedTransientWorktree(path) {
  return path.includes('/.worktrees/') || path.includes('/.claude/worktrees/')
}

/**
 * Нормалізує branch ref у назву для зіставлення з GitHub PR.
 * @param {string} ref повний ref
 * @returns {string} коротке ім'я
 */
function branchName(ref) {
  return ref.replace(REF_HEADS_RE, '').replace(REF_ORIGIN_RE, '')
}

/**
 * Дедуплікує local/remote refs одного commit: remote має пріоритет, але
 * worktree-protection локального ref переноситься у запис.
 * @param {Array<{ref:string, oid:string, date:string}>} refs сирі refs
 * @param {Map<string,string>} worktrees branch→path
 * @param {Map<string,string>} worktreeCommits checkout HEAD OID→path
 * @param {string[]} protectedBranches захищені policy branches
 * @returns {Array<{ref:string, oid:string, date:string, worktree:string|null,aliases:string[]}>} refs
 */
export function dedupeRefs(refs, worktrees, worktreeCommits = new Map(), protectedBranches = ['main']) {
  const byOid = new Map()
  for (const item of refs) {
    if (item.ref === 'refs/remotes/origin/HEAD' || protectedBranches.includes(branchName(item.ref))) continue
    const existing = byOid.get(item.oid)
    const worktree =
      worktrees.get(item.ref) ?? worktreeCommits.get(item.oid) ?? item.worktree ?? existing?.worktree ?? null
    const isRemote = item.ref.startsWith('refs/remotes/origin/')
    const aliases = [...new Set([...(existing?.aliases ?? []), ...(item.aliases ?? []), item.ref])].toSorted()
    if (!existing || isRemote) {
      byOid.set(item.oid, { ...item, worktree, aliases })
    } else if (worktree) {
      existing.worktree = worktree
      existing.aliases = aliases
    } else {
      existing.aliases = aliases
    }
  }
  return byOid
    .values()
    .toArray()
    .toSorted((a, b) => a.ref.localeCompare(b.ref))
}

/**
 * Визначає ancestry-відношення local branch до tracking upstream без зміни refs.
 * @param {string} localOid local tip
 * @param {string} upstreamOid upstream tip
 * @param {string} cwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {'synced'|'behind-only'|'ahead'|'diverged'} tracking state
 */
export function trackingRelation(localOid, upstreamOid, cwd, spawnFn = spawnSync) {
  if (localOid === upstreamOid) return 'synced'
  const localIsAncestor =
    git(['merge-base', '--is-ancestor', localOid, upstreamOid], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  if (localIsAncestor) return 'behind-only'
  const upstreamIsAncestor =
    git(['merge-base', '--is-ancestor', upstreamOid, localOid], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  return upstreamIsAncestor ? 'ahead' : 'diverged'
}

/**
 * Групує tracking-пару за effective tip без фізичного fast-forward.
 * Behind/synced аналізуються за remote tip, ahead — за local tip, diverged
 * лишаються двома незалежними sources. Worktree protection local ref
 * переноситься на effective candidate.
 * @param {Array<{ref:string,oid:string,date:string,upstream?:string}>} refs сирі refs
 * @param {Map<string,string>} worktrees branch→path
 * @param {Map<string,string>} worktreeCommits checkout HEAD OID→path
 * @param {string[]} protectedBranches policy-protected branches
 * @param {((localOid:string,upstreamOid:string)=>('synced'|'behind-only'|'ahead'|'diverged'))|null} relationFn ancestry classifier
 * @returns {Array<object>} effective refs
 */
export function groupTrackingRefs(
  refs,
  worktrees,
  worktreeCommits = new Map(),
  protectedBranches = ['main'],
  relationFn = null
) {
  const eligible = refs.filter(item => {
    return item.ref !== 'refs/remotes/origin/HEAD' && !protectedBranches.includes(branchName(item.ref))
  })
  const byRef = new Map(eligible.map(item => [item.ref, item]))
  const consumed = new Set()
  const grouped = []
  const localRefs = eligible
    .filter(item => item.ref.startsWith('refs/heads/'))
    .toSorted((left, right) => {
      return left.ref.localeCompare(right.ref)
    })

  for (const local of localRefs) {
    const upstream = local.upstream ? byRef.get(local.upstream) : null
    if (!upstream || consumed.has(local.ref) || consumed.has(upstream.ref)) continue
    const state = local.oid === upstream.oid ? 'synced' : (relationFn?.(local.oid, upstream.oid) ?? 'diverged')
    const tracking = {
      state,
      localRef: local.ref,
      upstreamRef: upstream.ref,
      localOid: local.oid,
      upstreamOid: upstream.oid
    }
    const worktree =
      worktrees.get(local.ref) ??
      worktrees.get(upstream.ref) ??
      worktreeCommits.get(local.oid) ??
      worktreeCommits.get(upstream.oid) ??
      null
    if (state === 'diverged') {
      grouped.push(
        { ...local, aliases: [local.ref], tracking, worktree },
        { ...upstream, aliases: [upstream.ref], tracking, worktree }
      )
    } else {
      const effective = state === 'ahead' ? local : upstream
      grouped.push({
        ...effective,
        aliases: [local.ref, upstream.ref],
        tracking,
        worktree
      })
    }
    consumed.add(local.ref)
    consumed.add(upstream.ref)
  }

  const ungrouped = eligible.filter(item => !consumed.has(item.ref))
  return dedupeRefs([...grouped, ...ungrouped], worktrees, worktreeCommits, protectedBranches)
}

/**
 * Класифікує branch лише за вже зібраними Git-фактами.
 * @param {{merged:boolean,novelCommitIds:string[],pr:object|null,worktree:string|null}} facts факти
 * @returns {string} state
 */
function branchState({ merged, novelCommitIds, pr, worktree }) {
  if (merged) return 'merged'
  if (novelCommitIds.length === 0) return 'patch-equivalent'
  if (pr) return 'open-pr'
  if (worktree) return 'protected'
  return 'review'
}

/**
 * Збирає відкриті PR; недоступний gh не блокує git-inventory.
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{items:Map<string,{number:number,url:string}>,warning:string|null}} inventory
 */
function openPullRequests(cwd, spawnFn) {
  const result = run(
    'gh',
    ['pr', 'list', '--state', 'open', '--limit', '500', '--json', 'headRefName,number,url'],
    cwd,
    spawnFn,
    { allowFailure: true }
  )
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `exit ${result.status}`
    return {
      items: new Map(),
      warning: `GitHub PR inventory недоступний: ${detail}`
    }
  }
  const rows = /** @type {Array<{headRefName:string,number:number,url:string}>} */ (parseJson(result.stdout, []))
  return {
    items: new Map(rows.map(row => [row.headRefName, { number: row.number, url: row.url }])),
    warning: null
  }
}

/**
 * Збирає compact commit metadata лише для patch-унікальних non-merge комітів.
 * @param {string[]} commitIds commit ids
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {Array<{oid:string,subject:string}>} коміти
 */
function commitMetadata(commitIds, cwd, spawnFn) {
  return commitIds.map(oid => {
    const subject = git(['show', '-s', '--format=%s', oid], cwd, spawnFn).stdout.trim()
    return { oid, subject }
  })
}

/**
 * Витягає конфліктні файли з `git merge-tree`.
 * @param {string} text merge-tree output
 * @returns {string[]} унікальні шляхи
 */
export function conflictFiles(text) {
  const files = new Set()
  for (const line of text.split('\n')) {
    const content = line.match(CONTENT_CONFLICT_RE)
    const rename = line.match(RENAME_DELETE_CONFLICT_RE)
    const modifyDelete = line.match(MODIFY_DELETE_CONFLICT_RE)
    const path = content?.[1] ?? rename?.[1] ?? modifyDelete?.[1]
    if (path) files.add(path)
  }
  return [...files].toSorted()
}

/**
 * Збирає детермінований Git inventory. Нічого не видаляє і не змінює у
 * checkout, крім оновлення remote refs через fetch --prune.
 * @param {string} cwd корінь репо
 * @param {{ spawnFn?: typeof spawnSync }} [deps] інжекти
 * @returns {{base:string,branches:Array<object>,stashes:Array<object>,worktrees:Array<object>,warnings:string[]}} inventory
 */
export function inventoryRepository(cwd, deps = {}) {
  const spawnFn = deps.spawnFn ?? spawnSync
  const policy = readGitPolicy(cwd)
  const baseRef = policyBaseRef(cwd)
  git(['fetch', '--prune', 'origin'], cwd, spawnFn)
  git(['rev-parse', '--verify', baseRef], cwd, spawnFn)

  const worktreeState = parseWorktreeState(git(['worktree', 'list', '--porcelain'], cwd, spawnFn).stdout)
  const refLines = git(
    ['for-each-ref', `--format=${REF_INVENTORY_FORMAT}`, 'refs/heads', 'refs/remotes/origin'],
    cwd,
    spawnFn
  )
    .stdout.split('\n')
    .filter(Boolean)
  const refs = groupTrackingRefs(
    refLines.map(line => {
      const [ref, oid, date, upstream] = line.split('\0')
      return { ref, oid, date, upstream }
    }),
    worktreeState.branches,
    worktreeState.commits,
    policy.protectedBranches,
    (localOid, upstreamOid) => trackingRelation(localOid, upstreamOid, cwd, spawnFn)
  )
  const prInventory = openPullRequests(cwd, spawnFn)
  const prs = prInventory.items
  const warnings = prInventory.warning ? [prInventory.warning] : []

  const branches = refs.map(item => {
    const name = branchName(item.ref)
    const merged =
      git(['merge-base', '--is-ancestor', item.ref, baseRef], cwd, spawnFn, {
        allowFailure: true
      }).status === 0
    const novelCommitIds = merged
      ? []
      : git(['rev-list', '--right-only', '--cherry-pick', '--no-merges', `${baseRef}...${item.ref}`], cwd, spawnFn)
          .stdout.split('\n')
          .filter(Boolean)
          .toReversed()
    const counts = git(['rev-list', '--left-right', '--count', `${baseRef}...${item.ref}`], cwd, spawnFn)
      .stdout.trim()
      .split(WHITESPACE_RE)
      .map(Number)
    const pr = prs.get(name) ?? null
    const state = branchState({ merged, novelCommitIds, pr, worktree: item.worktree })
    const changedFiles =
      state === 'review'
        ? git(['diff', '--name-status', `${baseRef}...${item.ref}`], cwd, spawnFn)
            .stdout.split('\n')
            .filter(Boolean)
            .slice(0, 200)
        : []
    const mergeTree =
      state === 'review' ? git(['merge-tree', baseRef, item.ref], cwd, spawnFn, { allowFailure: true }).stdout : ''
    return {
      source: `${SOURCE_BRANCH_PREFIX}${item.ref}`,
      ref: item.ref,
      aliases: item.aliases,
      tracking: item.tracking ?? null,
      name,
      oid: item.oid,
      date: item.date,
      state,
      worktree: item.worktree,
      pr,
      behind: counts[0] ?? 0,
      ahead: counts[1] ?? 0,
      commits: commitMetadata(novelCommitIds, cwd, spawnFn),
      changedFiles,
      conflicts: conflictFiles(mergeTree)
    }
  })

  const stashes = inventoryStashes(cwd, baseRef, spawnFn)

  const worktrees = worktreeState.entries.map(entry => {
    const present = existsSync(entry.path)
    const status =
      present && !entry.prunable
        ? git(['status', '--porcelain=v1'], entry.path, spawnFn, { allowFailure: true })
        : { status: 1, stdout: '' }
    return {
      ...entry,
      current: entry.path === cwd,
      managed: isManagedTransientWorktree(entry.path),
      dirty: status.status === 0 ? status.stdout.trim().length > 0 : null,
      protected: entry.branch ? policy.protectedBranches.includes(branchName(entry.branch)) : false
    }
  })

  return { base: baseRef, baseBranch: policy.baseBranch, branches, stashes, worktrees, warnings }
}

/**
 * Перевіряє, чи всі paths у stash tree вже мають тотожний стан у policy base.
 * Великий payload fail-closed лишається на semantic triage.
 * @param {string[]} paths змінені paths
 * @param {string} baseRef policy base ref
 * @param {string} treeish stash tree або untracked parent
 * @param {string} cwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {boolean} тотожність paths
 */
function stashPathsAbsorbed(paths, baseRef, treeish, cwd, spawnFn) {
  if (paths.length === 0) return true
  if (paths.length > STASH_PATH_LIMIT) return false
  return (
    git(['diff', '--quiet', baseRef, treeish, '--', ...paths], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  )
}

/**
 * Збирає tracked/untracked stash payload, absorbed-state та exact duplicate
 * signature без checkout/apply. Найновіший exact duplicate лишається
 * canonical, старіші стають patch-equivalent.
 * @param {string} cwd корінь репо
 * @param {string} baseRef policy base ref
 * @param {typeof spawnSync} [spawnFn] інжект
 * @returns {Array<object>} stash inventory
 */
export function inventoryStashes(cwd, baseRef, spawnFn = spawnSync) {
  const stashRows = git(['stash', 'list', '--format=%gd%x00%H%x00%gs'], cwd, spawnFn).stdout.split('\n').filter(Boolean)
  const canonicalBySignature = new Map()
  return stashRows.map(line => {
    const [ref, oid, subject] = line.split('\0')
    const source = `${SOURCE_STASH_PREFIX}${ref}`
    const changedFiles = git(['stash', 'show', '--name-status', '--include-untracked', ref], cwd, spawnFn)
      .stdout.split('\n')
      .filter(Boolean)
      .slice(0, 200)
    const trackedPaths = git(['diff', '--name-only', `${ref}^1`, ref], cwd, spawnFn)
      .stdout.split('\n')
      .filter(Boolean)
    const untrackedParent = git(['rev-parse', '--verify', `${ref}^3`], cwd, spawnFn, {
      allowFailure: true
    })
    const untrackedRef = untrackedParent.status === 0 ? `${ref}^3` : null
    const untrackedPaths = untrackedRef
      ? git(['ls-tree', '-r', '--name-only', untrackedRef], cwd, spawnFn).stdout.split('\n').filter(Boolean)
      : []
    const patch = git(['stash', 'show', '--patch', '--binary', '--include-untracked', ref], cwd, spawnFn)
    const signature =
      patch.status === 0
        ? git(['hash-object', '--stdin'], cwd, spawnFn, { input: patch.stdout }).stdout.trim() || null
        : null
    const duplicateOf = signature ? canonicalBySignature.get(signature) : null
    if (signature && !duplicateOf) canonicalBySignature.set(signature, source)
    const absorbed =
      stashPathsAbsorbed(trackedPaths, baseRef, ref, cwd, spawnFn) &&
      (!untrackedRef || stashPathsAbsorbed(untrackedPaths, baseRef, untrackedRef, cwd, spawnFn))
    let equivalence = null
    if (absorbed) equivalence = 'absorbed-in-base'
    else if (duplicateOf) equivalence = `duplicate-of:${duplicateOf}`
    return {
      source,
      ref,
      oid,
      subject,
      state: equivalence ? 'patch-equivalent' : 'review',
      changedFiles,
      ...(equivalence && { equivalence })
    }
  })
}

/**
 * Формує bounded semantic-triage prompt. Git-факти вже пораховані JS; модель
 * не виконує shell-команди й повертає лише JSON-рішення.
 * @param {Array<object>} candidates review branches/stashes
 * @param {string} task додатковий намір користувача
 * @returns {string} промпт
 */
export function buildTriagePrompt(candidates, task = '') {
  return [
    'Ти виконуєш лише semantic triage уже зібраних Git-фактів.',
    'Не запускай команди, не редагуй файли, не створюй PR і не видаляй refs.',
    task ? `Намір користувача: ${task}` : '',
    'Для кожного source поверни intent: complete-useful, incomplete, uncertain або obsolete та узгоджений action: pr, keep або drop.',
    'complete-useful → pr; incomplete/uncertain → keep; obsolete → drop. Groups розділяють незалежні PR.',
    'Conflict сам по собі НЕ є причиною keep: якщо intent завершений і корисний, обирай pr; наступний етап semantic conflict resolution перенесе його на актуальну base.',
    'keep — бракує доказів завершеності/корисності або робота активна/незавершена. drop — явно артефакт/застаріле.',
    'Для branch group commits — непорожній subset commit oid із facts. Для stash commits не потрібні.',
    'Відповідь — лише JSON без markdown:',
    '{"decisions":[{"source":"branch:refs/remotes/origin/x","intent":"complete-useful","action":"pr","rationale":"...","groups":[{"title":"fix: ...","commits":["oid"]}]}]}',
    JSON.stringify(candidates)
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Витягає JSON object із чистої або fenced відповіді.
 * @param {string} text відповідь моделі
 * @returns {object|null} object або null
 */
export function parseDecisionEnvelope(text) {
  const trimmed = text.trim()
  let unfenced = trimmed
  if (unfenced.startsWith('```')) {
    const firstLineEnd = unfenced.indexOf('\n')
    unfenced = firstLineEnd === -1 ? '' : unfenced.slice(firstLineEnd + 1)
    if (unfenced.endsWith('```')) unfenced = unfenced.slice(0, -3).trim()
  }
  const first = unfenced.indexOf('{')
  const last = unfenced.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  const parsed = parseJson(unfenced.slice(first, last + 1), null)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
}

/**
 * Викликає вибраний LLM runner для одного bounded-завдання.
 * @param {'pi'|'cursor'|'codex'} runner раннер
 * @param {string} prompt промпт
 * @param {string} cwd робочий каталог
 * @param {object} deps інжекти
 * @param {'min'|'max'} [tier] model tier
 * @returns {Promise<{ok:boolean,text:string,error:string|null}>} результат
 */
export async function callRunner(runner, prompt, cwd, deps = {}, tier = 'max') {
  if (runner === 'pi') {
    let runAgentSkill = deps.runAgentSkill
    if (!runAgentSkill) {
      const module = await import('@7n/llm-lib/agent-skill')
      runAgentSkill = module.runAgentSkill
    }
    let text = ''
    const result = await runAgentSkill(prompt, {
      skillId: 'git-reconcile',
      tier,
      cwd,
      deps: { out: chunk => (text += chunk) }
    })
    return { ok: result.ok, text, error: result.error }
  }

  let runAcpAgent = deps.runAcpAgent
  if (!runAcpAgent) {
    const module = await import('@7n/llm-lib/acp')
    runAcpAgent = module.runAcpAgent
  }
  const previousProgress = env[ACP_PROGRESS_ENV]
  const verbose = ['1', 'true'].includes((env.N_LLM_ACP_VERBOSE ?? '').toLowerCase())
  if (previousProgress === undefined && !verbose) env[ACP_PROGRESS_ENV] = '0'
  try {
    const text = await runAcpAgent(runner, prompt, cwd, { tier })
    return { ok: true, text, error: null }
  } catch (error) {
    return { ok: false, text: '', error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (previousProgress === undefined) delete env[ACP_PROGRESS_ENV]
    else env[ACP_PROGRESS_ENV] = previousProgress
  }
}

/**
 * Виконує bounded LLM-крок через min, валідовує результат JS-функцією і
 * викликає max лише після конкретного провалу.
 * @param {object} args параметри
 * @returns {Promise<{ok:boolean,text:string,error:string|null,tier:'min'|'max',validation?:object,attempts:Array<object>}>} результат
 */
export async function callWithValidatedFallback(args) {
  const { runner, prompt, cwd, validate, remediate, deps = {}, log = noop, label = 'LLM', onAttempt = noop } = args
  const call = deps.callRunner ?? callRunner
  const attempts = []
  let retryPrompt = prompt

  for (const tier of LLM_TIERS) {
    onAttempt({ label, tier })
    const outcome = await call(runner, retryPrompt, cwd, deps, tier)
    if (!outcome.ok) {
      const validation = { ok: false, error: outcome.error ?? `${tier} runner failed` }
      attempts.push({ tier, ok: false, validation })
      return { ...outcome, tier, validation, attempts }
    }
    let validation = await validate(outcome)
    let remediation = null
    if (!validation.ok && tier === 'min' && remediate) {
      remediation = await remediate(validation)
      if (remediation?.attempted) {
        validation = await validate(outcome)
        if (validation.ok) log(`↺ ${label}: deterministic fixer усунув min validation failure`)
      }
    }
    attempts.push({ tier, ok: outcome.ok, validation, ...(remediation && { remediation }) })
    if (validation.ok) {
      return { ...outcome, tier, validation, attempts, ...(remediation?.attempted && { remediated: true }) }
    }
    if (tier === 'min') {
      const reason = (validation.error ?? outcome.error ?? 'невідома помилка validation').slice(0, PROMPT_TEXT_LIMIT)
      log(`↗ ${label}: min не пройшов validation (${reason}); повторюю на max`)
      retryPrompt = [
        prompt,
        `Попередня min-спроба не пройшла deterministic validation: ${reason}.`,
        'Виправ причину validation; не розширюй scope.'
      ].join('\n\n')
    } else {
      return {
        ok: false,
        text: outcome.text,
        error: validation.error ?? outcome.error ?? 'max validation failed',
        tier,
        validation,
        attempts
      }
    }
  }

  throw new Error('Недосяжний стан LLM fallback')
}

/**
 * Перевіряє branch groups та їх commit OID.
 * @param {object} decision LLM decision
 * @param {object} candidate inventory candidate
 * @returns {string|null} validation error
 */
function validateBranchGroups(decision, candidate) {
  const validCommitIds = new Set(candidate.commits?.map(commit => commit.oid))
  const selectedCommitIds = new Set()
  for (const group of decision.groups) {
    if (!Array.isArray(group.commits) || group.commits.length === 0) {
      return `branch group без commits для ${decision.source}`
    }
    if (group.commits.some(oid => !validCommitIds.has(oid))) {
      return `branch group містить невідомий commit для ${decision.source}`
    }
    if (group.commits.some(oid => selectedCommitIds.has(oid))) {
      return `commit повторюється між groups для ${decision.source}`
    }
    for (const oid of group.commits) selectedCommitIds.add(oid)
  }
  return null
}

/**
 * Перевіряє groups одного PR-рішення.
 * @param {object} decision LLM decision
 * @param {object} candidate inventory candidate
 * @returns {string|null} validation error
 */
function validatePrDecision(decision, candidate) {
  if (!Array.isArray(decision.groups) || decision.groups.length === 0) {
    return `pr без groups для ${decision.source}`
  }
  if (decision.groups.some(group => typeof group.title !== 'string' || group.title.trim().length === 0)) {
    return `pr group без title для ${decision.source}`
  }
  if (!decision.source.startsWith(SOURCE_BRANCH_PREFIX)) {
    return decision.groups.length === 1 ? null : `неподільний stash має містити рівно одну pr group: ${decision.source}`
  }
  return validateBranchGroups(decision, candidate)
}

/**
 * Перевіряє одне triage-рішення.
 * @param {object} decision LLM decision
 * @param {object|undefined} candidate inventory candidate
 * @param {Set<string>} seen уже оброблені source
 * @returns {string|null} validation error
 */
function validateDecision(decision, candidate, seen) {
  if (!candidate || seen.has(decision.source)) {
    return `невідомий або дубльований source: ${decision.source}`
  }
  seen.add(decision.source)
  if (!['pr', 'keep', 'drop'].includes(decision.action)) {
    return `невалідний action для ${decision.source}`
  }
  const actionByIntent = new Map([
    ['complete-useful', 'pr'],
    ['incomplete', 'keep'],
    ['uncertain', 'keep'],
    ['obsolete', 'drop']
  ])
  if (!actionByIntent.has(decision.intent)) {
    return `невалідний intent для ${decision.source}`
  }
  if (actionByIntent.get(decision.intent) !== decision.action) {
    return `intent/action не узгоджені для ${decision.source}`
  }
  return decision.action === 'pr' ? validatePrDecision(decision, candidate) : null
}

/**
 * Структурно перевіряє triage-рішення: рівно один verdict на candidate,
 * валідні actions/groups і лише відомі commit OID.
 * @param {{text:string}} outcome LLM output
 * @param {Array<object>} candidates batch
 * @returns {{ok:boolean,error?:string,value?:object}} validation
 */
export function validateTriageOutcome(outcome, candidates) {
  const envelope = parseDecisionEnvelope(outcome.text)
  if (!Array.isArray(envelope?.decisions)) return { ok: false, error: 'відсутній decisions array' }
  if (envelope.decisions.length !== candidates.length) {
    return { ok: false, error: 'кількість decisions не збігається з candidates' }
  }

  const bySource = new Map(candidates.map(candidate => [candidate.source, candidate]))
  const seen = new Set()
  for (const decision of envelope.decisions) {
    const error = validateDecision(decision, bySource.get(decision.source), seen)
    if (error) return { ok: false, error }
  }
  return { ok: true, value: envelope }
}

/**
 * Збирає bounded факти з фінального diff для grounded бізнесового й
 * архітектурного опису PR без повторного repository exploration моделлю.
 * @param {object} args контекст готового PR
 * @returns {object} факти опису PR
 */
export function collectPullRequestFacts(args) {
  const { cwd, baseRef, source, title, rationale = '', verification = '', spawnFn = spawnSync } = args
  const range = `${baseRef}...HEAD`
  const changedPaths = git(['diff', '--name-only', range], cwd, spawnFn).stdout.split('\n').filter(Boolean)
  const diff = git(['diff', '--no-ext-diff', '--unified=2', range], cwd, spawnFn).stdout
  return {
    source,
    title,
    rationale,
    verification: verificationSummary(verification),
    baseRef,
    commits: git(['log', '--format=%h%x09%s', range], cwd, spawnFn).stdout.split('\n').filter(Boolean),
    changedPaths,
    diffProfile: pullRequestDiffProfile(changedPaths),
    diffStat: git(['diff', '--stat', range], cwd, spawnFn).stdout.trim(),
    diff: diff.length > PR_DIFF_TEXT_LIMIT ? `${diff.slice(0, PR_DIFF_TEXT_LIMIT)}\n[diff truncated by JS]` : diff
  }
}

/**
 * Перетворює довільний agent transcript на bounded deterministic verdict.
 * @param {string} verification raw behavioral output або no-code sentinel
 * @returns {string} безпечний summary для prompt і PR body
 */
export function verificationSummary(verification) {
  if (!verification) return ''
  if (verification === NO_CODE_VERIFICATION) {
    return 'Behavioral LLM не викликався, бо final diff не містить code paths.'
  }
  return 'Behavioral LLM review завершено; acceptance підтверджують фінальні детерміновані Git, tests, lint і changelog gates.'
}

/**
 * Класифікує фінальний diff без LLM, щоб release metadata + lockfile
 * залишались валідним PR, але narrative не приписував їм runtime-зміни.
 * @param {string[]} paths фактичні changed paths
 * @returns {{kind:'general'|'release-lock-only',releaseEntryPaths:string[],lockfilePaths:string[]}} профіль final diff
 */
export function pullRequestDiffProfile(paths) {
  const releaseEntryPaths = paths.filter(path => CHANGE_ENTRY_RE.test(path))
  const lockfilePaths = paths.filter(path => LOCKFILE_RE.test(path))
  const knownPaths = new Set([...releaseEntryPaths, ...lockfilePaths])
  return {
    kind:
      releaseEntryPaths.length > 0 && lockfilePaths.length > 0 && paths.every(path => knownPaths.has(path))
        ? 'release-lock-only'
        : 'general',
    releaseEntryPaths,
    lockfilePaths
  }
}

/**
 * Відокремлює narrative change entry від YAML frontmatter.
 * @param {string} text change entry
 * @returns {string} normalized narrative
 */
function changeEntryNarrative(text) {
  const lines = text.trim().split('\n')
  let body = lines
  if (lines[0]?.trim() === '---') {
    const closing = lines.slice(1).findIndex(line => line.trim() === '---')
    if (closing !== -1) body = lines.slice(closing + 2)
  }
  return body.join(' ').trim().replace(LEADING_MARKDOWN_BULLET_RE, '').split(WHITESPACE_RE).join(' ')
}

/**
 * Знаходить release entries, exact narrative яких уже присутній у base
 * CHANGELOG відповідного workspace.
 * @param {string} cwd materialized worktree
 * @param {string} baseRef policy base ref
 * @param {{releaseEntryPaths:string[]}} profile final diff profile
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string[]} already released entry paths
 */
export function releasedChangeEntries(cwd, baseRef, profile, spawnFn = spawnSync) {
  const released = []
  for (const entryPath of profile.releaseEntryPaths ?? []) {
    const marker = '/.changes/'
    const markerIndex = entryPath.indexOf(marker)
    const workspace = markerIndex === -1 ? '' : entryPath.slice(0, markerIndex)
    const changelogPath = workspace ? `${workspace}/CHANGELOG.md` : 'CHANGELOG.md'
    const baseChangelog = git(['show', `${baseRef}:${changelogPath}`], cwd, spawnFn, { allowFailure: true })
    if (baseChangelog.status !== 0) continue
    const narrative = changeEntryNarrative(readFileSync(join(cwd, entryPath), 'utf8'))
    if (!narrative) continue
    const normalizedChangelog = baseChangelog.stdout.split(WHITESPACE_RE).join(' ')
    if (normalizedChangelog.includes(narrative)) released.push(entryPath)
  }
  return released
}

/**
 * Формує bounded prompt, який забороняє implementation-changelog і вимагає
 * business/architecture narrative лише з підготовлених JS-фактів.
 * @param {object} facts фінальні Git та behavioral факти
 * @returns {string} промпт
 */
export function buildPullRequestDescriptionPrompt(facts) {
  const scopeRule =
    facts.diffProfile?.kind === 'release-lock-only'
      ? 'Final diff містить лише release entries та lockfile. Це валідний PR: опиши product intent із change entry, але не стверджуй, що цей PR сам реалізує runtime behavior або змінює runtime architecture.'
      : 'Чітко відрізняй intent source commit від змін, які справді присутні у final diff.'
  return [
    'Ти формуєш лише зміст PR description за вже зібраними JS-фактами.',
    'Не запускай команди, не редагуй файли, не створюй PR і не вигадуй відсутній контекст.',
    'Поясни передусім: навіщо зміна потрібна, який дає продуктово-операційний результат, як змінює responsibilities, boundaries, contracts або data/control flow.',
    'Не переказуй diff по функціях і рядках. Називай implementation detail лише коли він є важливим architecture contract.',
    'Не вигадуй клієнтів, фінансові метрики, deployment status або гарантії. Якщо бізнес-контекст обмежений, чесно сформулюй підтверджений operational/developer outcome.',
    'Кожне твердження обґрунтуй facts; evidencePaths мають бути точними changedPaths.',
    scopeRule,
    'Business context разом із businessOutcomes та architectureChanges має бути не коротшим за behaviorChanges разом із risksAndCompatibility.',
    'Поверни лише JSON object без markdown:',
    '{"businessContext":"...","businessOutcomes":["..."],"architectureChanges":["..."],"behaviorChanges":["..."],"risksAndCompatibility":["..."],"evidencePaths":["path/from/changedPaths"]}',
    JSON.stringify(facts)
  ].join('\n\n')
}

/**
 * Перевіряє структуру, factual anchors і перевагу business/architecture
 * змісту перед дрібними деталями реалізації.
 * @param {{text:string}} outcome LLM output
 * @param {{changedPaths:string[]}} facts фінальні Git-факти
 * @returns {{ok:boolean,error?:string,value?:object}} validation
 */
export function validatePullRequestDescription(outcome, facts) {
  let description = parseDecisionEnvelope(outcome.text)
  if (!description) return { ok: false, error: 'відсутній JSON object опису PR' }
  if (
    typeof description.businessContext !== 'string' ||
    description.businessContext.trim().length < 40 ||
    description.businessContext.length > 1200 ||
    description.businessContext.includes('\n')
  ) {
    return { ok: false, error: 'businessContext має бути змістовним однорядковим текстом' }
  }
  for (const field of PR_DESCRIPTION_ARRAY_FIELDS) {
    const values = description[field]
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.length > 5 ||
      values.some(
        value => typeof value !== 'string' || value.trim().length < 15 || value.length > 600 || value.includes('\n')
      )
    ) {
      return { ok: false, error: `${field} має містити 1-5 змістовних однорядкових пунктів` }
    }
  }
  const changedPaths = new Set(facts.changedPaths)
  if (
    !Array.isArray(description.evidencePaths) ||
    description.evidencePaths.length === 0 ||
    description.evidencePaths.length > 12 ||
    description.evidencePaths.some(path => typeof path !== 'string' || !changedPaths.has(path))
  ) {
    return { ok: false, error: 'evidencePaths мають бути непорожнім subset фактичних changedPaths' }
  }
  if (facts.diffProfile?.kind === 'release-lock-only') {
    description = {
      ...description,
      businessOutcomes: description.businessOutcomes.map(
        outcome => `Product intent, зафіксований у change entry: ${outcome.trim()}`
      ),
      architectureChanges: RELEASE_LOCK_ARCHITECTURE,
      behaviorChanges: RELEASE_LOCK_BEHAVIOR
    }
  }
  const focusedLength =
    description.businessContext.length +
    description.businessOutcomes.join('').length +
    description.architectureChanges.join('').length
  const detailLength = description.behaviorChanges.join('').length + description.risksAndCompatibility.join('').length
  if (focusedLength < detailLength) {
    return { ok: false, error: 'business та architecture зміст коротший за behavior/risk details' }
  }
  return { ok: true, value: description }
}

/**
 * Форматує validated narrative items як Markdown bullets.
 * @param {string[]} values пункти секції
 * @returns {string} Markdown
 */
function markdownBullets(values) {
  return values.map(value => `- ${value.trim()}`).join('\n')
}

/**
 * Рендерить стабільний PR body: business та architecture секції видимі
 * першими, а source/evidence залишаються у forensic details.
 * @param {object} args validated description та deterministic facts
 * @param {object} args.description validated narrative
 * @param {object} args.facts deterministic Git facts
 * @returns {string} Markdown PR body
 */
export function renderPullRequestBody({ description, facts }) {
  const inline = value => String(value).trim().split(WHITESPACE_RE).join(' ')
  const evidence = description.evidencePaths.map(path => `- \`${path.replaceAll('`', '\\`')}\``).join('\n')
  const scopeNotice =
    facts.diffProfile?.kind === 'release-lock-only'
      ? [
          '> [!NOTE]',
          '> Final diff цього PR містить лише release metadata та lockfile. Product outcome нижче описує intent change entry, а не нову runtime implementation у цьому diff.',
          ''
        ]
      : []
  return [
    '## Навіщо',
    '',
    ...scopeNotice,
    description.businessContext.trim(),
    '',
    '## Бізнес-результат',
    '',
    markdownBullets(description.businessOutcomes),
    '',
    '## Архітектура',
    '',
    markdownBullets(description.architectureChanges),
    '',
    '## Поведінка',
    '',
    markdownBullets(description.behaviorChanges),
    '',
    '## Ризики та сумісність',
    '',
    markdownBullets(description.risksAndCompatibility),
    '',
    '## Перевірки',
    '',
    `- \`git diff --check ${facts.baseRef}...HEAD\``,
    '- scoped code lint/tests та domain lint для non-code paths',
    '- `npx @7n/rules lint changelog --no-fix`',
    ...(facts.verification ? [`- Behavioral verification: ${inline(facts.verification)}`] : []),
    '',
    '<details>',
    '<summary>Технічні докази перенесення</summary>',
    '',
    `Джерело: \`${facts.source.replaceAll('`', '\\`')}\`.`,
    '',
    evidence,
    '',
    '</details>'
  ].join('\n')
}

/**
 * Генерує validated PR narrative через min→validation→max над фінальним diff.
 * @param {object} args контекст готового worktree
 * @returns {Promise<string>} deterministic Markdown body
 */
export async function describePullRequest(args) {
  const { runner, cwd, baseRef, source, title, rationale, verification, deps, spawnFn, log, onProgress = noop } = args
  const collectFacts = deps.collectPullRequestFacts ?? collectPullRequestFacts
  const facts = collectFacts({ cwd, baseRef, source, title, rationale, verification, spawnFn })
  const outcome = await callWithValidatedFallback({
    runner,
    prompt: buildPullRequestDescriptionPrompt(facts),
    cwd,
    deps,
    log,
    label: `PR description ${source}`,
    onAttempt: ({ tier }) => onProgress('PR description', tier),
    validate: result => validatePullRequestDescription(result, facts)
  })
  if (!outcome.ok) throw new Error(`LLM PR description: ${outcome.error}`)
  return renderPullRequestBody({ description: outcome.validation.value, facts })
}

/**
 * Перетворює довільний title/ref на branch slug.
 * @param {string} value title/ref
 * @returns {string} slug
 */
export function branchSlug(value) {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 40)
    .replaceAll(/^-|-$/g, '')
  return slug || 'change'
}

/**
 * Обирає вільний native `mt` name для rescue-worktree.
 * @param {string} title PR title
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string} worktree name
 */
function chooseBranch(title, cwd, spawnFn) {
  const base = `reconcile-${branchSlug(title)}`
  let candidate = base
  let suffix = 2
  while (
    git(['show-ref', '--verify', '--quiet', `refs/heads/mt/${candidate}`], cwd, spawnFn, {
      allowFailure: true
    }).status === 0 ||
    git(['ls-remote', '--exit-code', '--heads', 'origin', `mt/${candidate}`], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  ) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

/**
 * Створює керований native `mt` worktree від policy base ref без зміни
 * вихідного checkout.
 * @param {string} title PR title
 * @param {string} source source id
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{branch:string,worktreeName:string,cwd:string}} worktree
 */
function createReconcileWorktree(title, source, cwd, spawnFn) {
  const baseRef = policyBaseRef(cwd)
  const worktreeName = chooseBranch(title, cwd, spawnFn)
  const branch = `mt/${worktreeName}`
  let worktreeCwd
  try {
    run(
      'mt',
      ['worktree', 'create', worktreeName, '--base', baseRef, '--description', `git-reconcile: ${source}`],
      cwd,
      spawnFn
    )
    const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain'], cwd, spawnFn).stdout)
    worktreeCwd = worktrees.get(`refs/heads/${branch}`)
    if (!worktreeCwd) throw new Error(`mt не зареєстрував worktree для ${branch}`)
    return { branch, worktreeName, cwd: worktreeCwd }
  } catch (error) {
    const setupError = error instanceof Error ? error : new Error(String(error))
    setupError.branch = branch
    if (worktreeCwd) setupError.worktree = worktreeCwd
    throw setupError
  }
}

/**
 * Додає `.worktrees/` до локального Git exclude без tracked-змін у consumer.
 * Це не замінює repository Vitest excludes, але не лишає root checkout dirty
 * через керовані або forensic worktree.
 * @param {string} cwd корінь repository
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {boolean} чи локальний exclude було змінено
 */
export function ensureLocalWorktreeExclude(cwd, spawnFn = spawnSync) {
  try {
    const excludePath = git(['rev-parse', '--git-path', 'info/exclude'], cwd, spawnFn).stdout.trim()
    if (!excludePath) return false
    const absoluteExcludePath = isAbsolute(excludePath) ? excludePath : join(cwd, excludePath)
    const existing = existsSync(absoluteExcludePath) ? readFileSync(absoluteExcludePath, 'utf8') : ''
    if (existing.split('\n').some(line => line.trim() === '.worktrees/')) return false
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    appendFileSync(absoluteExcludePath, `${separator}.worktrees/\n`)
    return true
  } catch {
    return false
  }
}

/**
 * Прибирає reconciliation worktree або fail-closed лишає source неочищеним.
 * @param {{branch:string,worktreeName:string,cwd:string}} worktree створений worktree
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 */
function removeReconcileWorktree(worktree, rootCwd, spawnFn) {
  const removed = run('mt', ['worktree', 'remove', worktree.worktreeName, '--force'], rootCwd, spawnFn, {
    allowFailure: true
  })
  if (removed.status !== 0) {
    throw new Error(`worktree cleanup: ${removed.stderr || removed.stdout}`)
  }
}

/**
 * Перевіряє, чи лишились unmerged paths.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string[]} шляхи
 */
function unresolvedFiles(cwd, spawnFn) {
  return git(['diff', '--name-only', '--diff-filter=U'], cwd, spawnFn).stdout.split('\n').filter(Boolean)
}

/**
 * Пропускає лише підтверджений empty cherry-pick: sequencer активний,
 * конфліктів немає, staged diff порожній.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {boolean} чи виконано cherry-pick --skip
 */
export function skipEmptyCherryPick(cwd, spawnFn = spawnSync) {
  const inProgress =
    git(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  if (!inProgress || unresolvedFiles(cwd, spawnFn).length > 0) return false
  const stagedEmpty =
    git(['diff', '--cached', '--quiet'], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  if (!stagedEmpty) return false
  git(['cherry-pick', '--skip'], cwd, spawnFn)
  return true
}

/**
 * Завершує активний cherry-pick: semantic no-op пропускає, непорожній
 * продовжує. Відсутній sequencer не потребує дії.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {'none'|'skipped'|'continued'} виконана дія
 */
export function finishCherryPick(cwd, spawnFn = spawnSync) {
  const inProgress =
    git(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  if (!inProgress) return 'none'
  if (skipEmptyCherryPick(cwd, spawnFn)) return 'skipped'
  git(['cherry-pick', '--continue'], cwd, spawnFn)
  return 'continued'
}

/**
 * Перевіряє реальний tree diff, а не лише кількість commits ahead.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {boolean} чи є що переносити в PR
 */
export function hasChangesFromBase(cwd, spawnFn = spawnSync) {
  const baseRef = policyBaseRef(cwd)
  return (
    git(['diff', '--quiet', `${baseRef}...HEAD`], cwd, spawnFn, {
      allowFailure: true
    }).status !== 0 ||
    git(['diff', '--quiet', baseRef, '--'], cwd, spawnFn, {
      allowFailure: true
    }).status !== 0 ||
    git(['ls-files', '--others', '--exclude-standard'], cwd, spawnFn).stdout.trim().length > 0
  )
}

/**
 * Перевіряє, що agentic-крок залишив Git у консистентному стані.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{ok:boolean,error?:string}} validation
 */
function validateGitState(cwd, spawnFn) {
  const unresolved = unresolvedFiles(cwd, spawnFn)
  if (unresolved.length > 0) {
    return { ok: false, error: `нерозв'язані конфлікти: ${unresolved.join(', ')}` }
  }
  const diffCheck = git(['diff', '--check'], cwd, spawnFn, { allowFailure: true })
  if (diffCheck.status !== 0) {
    return { ok: false, error: `git diff --check: ${diffCheck.stderr || diffCheck.stdout}` }
  }
  return { ok: true }
}

/** Межі стабільного Vitest failure identifier. */
const ANSI_ESCAPE = String.fromCodePoint(27)
const TEST_FAILURE_PREFIX = 'FAIL  '

/**
 * Витягає стабільні Vitest failure identifiers без summary/timing.
 * @param {string} output stdout + stderr
 * @returns {Set<string>} suite/test failures
 */
export function testFailureSignatures(output) {
  const signatures = new Set()
  for (const line of output.split('\n')) {
    const start = line.indexOf(TEST_FAILURE_PREFIX)
    if (start === -1) continue
    const signature = line
      .slice(start + TEST_FAILURE_PREFIX.length)
      .split(ANSI_ESCAPE, 1)[0]
      .trim()
    if (signature) signatures.add(signature)
  }
  return signatures
}

/**
 * Дозволяє red baseline лише якщо після перенесення не з'явилось нових
 * Vitest failures. Нерозпізнаний red output завжди fail-closed.
 * @param {{status:number,stdout:string,stderr:string}|null} baseline до змін
 * @param {{status:number,stdout:string,stderr:string}} current після змін
 * @returns {boolean} чи test gate пройдено
 */
export function acceptsTestOutcome(baseline, current) {
  if (current.status === 0) return true
  if (!baseline || baseline.status === 0) return false
  const before = testFailureSignatures(`${baseline.stdout}\n${baseline.stderr}`)
  const after = testFailureSignatures(`${current.stdout}\n${current.stderr}`)
  return before.size > 0 && after.size > 0 && [...after].every(signature => before.has(signature))
}

/**
 * Зводить змінені code paths до найвужчих директорій для scoped gates.
 * @param {string[]} paths relative paths
 * @returns {string[]} унікальні sorted directories
 */
export function sourceDirectories(paths) {
  return [...new Set(paths.filter(path => SOURCE_CODE_RE.test(path)).map(path => dirname(path)))].toSorted()
}

/**
 * Визначає технічний залишок, який містить лише release entries. Такі файли
 * не доводять окремої корисної поведінки й не мають породжувати PR.
 * @param {string[]} paths змінені шляхи відносно policy base
 * @returns {boolean} чи всі зміни лежать безпосередньо у `.changes/`
 */
export function hasOnlyChangeEntries(paths) {
  return paths.length > 0 && paths.every(path => CHANGE_ENTRY_RE.test(path))
}

/**
 * Збирає tracked і untracked code directories відносно policy base ref.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string[]} directories
 */
function changedPaths(cwd, spawnFn) {
  const tracked = git(['diff', '--name-only', policyBaseRef(cwd), '--'], cwd, spawnFn)
    .stdout.split('\n')
    .filter(Boolean)
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd, spawnFn).stdout.split('\n').filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
}

/**
 * Прибирає no-op або change-only worktree до дорогих behavioral/CI gates.
 * @param {object} args контекст materialized worktree
 * @returns {{status:string,branch:string,rationale?:string}|null} terminal outcome
 */
export function discardPatchEquivalentWorktree(args) {
  const { worktree, rootCwd, spawnFn, onProgress, validated = false } = args
  if (!hasChangesFromBase(worktree.cwd, spawnFn)) {
    onProgress('remove no-op worktree')
    removeReconcileWorktree(worktree, rootCwd, spawnFn)
    return { status: 'patch-equivalent', branch: worktree.branch }
  }
  const paths = changedPaths(worktree.cwd, spawnFn)
  const profile = pullRequestDiffProfile(paths)
  if (profile.kind === 'release-lock-only') {
    const released = releasedChangeEntries(worktree.cwd, policyBaseRef(worktree.cwd), profile, spawnFn)
    if (released.length === profile.releaseEntryPaths.length) {
      onProgress('remove already-released worktree')
      removeReconcileWorktree(worktree, rootCwd, spawnFn)
      return {
        status: 'patch-equivalent',
        branch: worktree.branch,
        rationale: `Release intent уже присутній у base CHANGELOG: ${released.join(', ')}`
      }
    }
  }
  if (!hasOnlyChangeEntries(paths)) return null

  onProgress('remove change-only worktree')
  removeReconcileWorktree(worktree, rootCwd, spawnFn)
  return {
    status: 'patch-equivalent',
    branch: worktree.branch,
    rationale: validated
      ? 'Після Git validation лишилися тільки release entries у .changes/'
      : 'Після перенесення лишилися тільки release entries у .changes/'
  }
}

/**
 * Повертає директорії зміненого коду.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string[]} directories
 */
function changedSourceDirectories(cwd, spawnFn) {
  return sourceDirectories(changedPaths(cwd, spawnFn)).filter(path => existsSync(join(cwd, path === '.' ? '' : path)))
}

/**
 * Повертає директорії non-code змін для фінального domain lint.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string[]} directories
 */
export function changedNonCodeDirectories(cwd, spawnFn = spawnSync) {
  return [
    ...new Set(
      changedPaths(cwd, spawnFn)
        .filter(path => !SOURCE_CODE_RE.test(path))
        .map(path => dirname(path))
    )
  ]
    .filter(path => existsSync(join(cwd, path === '.' ? '' : path)))
    .toSorted()
}

/**
 * Генерує docs і запускає unified read-only lint лише в директоріях
 * зміненого коду, не торкаючись repository-wide baseline.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {(stage:string)=>void} [onProgress] stage callback
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{ok:boolean,error?:string}>} gate
 */
async function validateScopedProjectGates(cwd, spawnFn, onProgress = noop, asyncSpawnFn = null) {
  const longRunner = resolveAsyncSpawn(spawnFn, asyncSpawnFn)
  for (const path of changedSourceDirectories(cwd, spawnFn)) {
    onProgress(`doc-files (${path})`)
    const docs = await runAsync('npx', ['@7n/rules', 'lint', 'doc-files', '--path', path], cwd, longRunner, {
      allowFailure: true
    })
    if (docs.status !== 0) {
      return {
        ok: false,
        error: `doc-files (${path}): ${docs.stderr || docs.stdout}`,
        remediation: 'canonical-fixers'
      }
    }
    onProgress(`scoped lint (${path})`)
    const lint = await runAsync('npx', ['@7n/rules', 'lint', '--path', path, '--no-fix'], cwd, longRunner, {
      allowFailure: true
    })
    if (lint.status !== 0) {
      return {
        ok: false,
        error: `scoped lint (${path}): ${lint.stderr || lint.stdout}`,
        remediation: 'canonical-fixers'
      }
    }
  }
  return { ok: true }
}

/**
 * Запускає canonical fixers у worktree до ескалації min→max. Це прибирає
 * formatting/CSpell/doc/changelog дефекти без повторного behavioral LLM.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {{remediation?:string}} validation провалена validation
 * @param {(stage:string)=>void} [onProgress] stage callback
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{attempted:boolean,ok:boolean,error?:string}>} результат
 */
export async function remediateBehaviorState(
  cwd,
  spawnFn = spawnSync,
  validation = {},
  onProgress = noop,
  asyncSpawnFn = null
) {
  if (validation.remediation !== 'canonical-fixers') return { attempted: false, ok: false }

  const longRunner = resolveAsyncSpawn(spawnFn, asyncSpawnFn)
  const changedDirectories = [
    ...new Set([...changedSourceDirectories(cwd, spawnFn), ...changedNonCodeDirectories(cwd, spawnFn)])
  ].toSorted()
  for (const path of changedDirectories) {
    onProgress(`deterministic fix (${path})`)
    const fixed = await runAsync('npx', ['@7n/rules', 'lint', '--path', path], cwd, longRunner, {
      allowFailure: true
    })
    if (fixed.status !== 0) {
      return {
        attempted: true,
        ok: false,
        error: `canonical fix (${path}): ${fixed.stderr || fixed.stdout}`
      }
    }
  }

  onProgress('deterministic changelog fix')
  const changelog = await runAsync('npx', ['@7n/rules', 'lint', 'changelog'], cwd, longRunner, {
    allowFailure: true
  })
  if (changelog.status !== 0) {
    return {
      attempted: true,
      ok: false,
      error: `canonical changelog fix: ${changelog.stderr || changelog.stdout}`
    }
  }
  return { attempted: true, ok: true }
}

/**
 * Встановлює frozen Bun dependencies, якщо новий worktree їх ще не має.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {CommandRunner|undefined} asyncSpawnFn async runner
 * @returns {Promise<void>} завершення install
 */
async function ensureWorktreeDependencies(cwd, spawnFn, asyncSpawnFn) {
  if (!existsSync(join(cwd, 'package.json')) || !existsSync(join(cwd, 'bun.lock'))) return
  if (existsSync(join(cwd, 'node_modules'))) return
  await runAsync('bun', ['install', '--frozen-lockfile'], cwd, resolveAsyncSpawn(spawnFn, asyncSpawnFn))
}

/**
 * Фіксує test baseline на чистій policy base гілці до перенесення source.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{tests:{status:number,stdout:string,stderr:string}|null}>} baseline
 */
export async function captureBehaviorBaseline(cwd, spawnFn = spawnSync, asyncSpawnFn = null) {
  await ensureWorktreeDependencies(cwd, spawnFn, asyncSpawnFn)
  const packageJsonPath = join(cwd, 'package.json')
  if (!existsSync(packageJsonPath)) return { tests: null }
  const packageJson = parseJson(readFileSync(packageJsonPath, 'utf8'), {})
  const tests = packageJson?.scripts?.test
    ? await runAsync('bun', ['run', 'test'], cwd, resolveAsyncSpawn(spawnFn, asyncSpawnFn), { allowFailure: true })
    : null
  return { tests }
}

/**
 * Повторно використовує test baseline однієї policy base гілки між PR-групами.
 * Залежності все одно встановлюються в кожному окремому worktree.
 * @param {string} cwd worktree
 * @param {Map<string,object>} cache кеш за OID бази
 * @param {typeof spawnSync} spawnFn інжект
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{baseline:object,cached:boolean}>} baseline і ознака cache hit
 */
export async function captureCachedBehaviorBaseline(cwd, cache, spawnFn = spawnSync, asyncSpawnFn = null) {
  await ensureWorktreeDependencies(cwd, spawnFn, asyncSpawnFn)
  const baseOid = git(['rev-parse', policyBaseRef(cwd)], cwd, spawnFn).stdout.trim()
  if (cache.has(baseOid)) return { baseline: await cache.get(baseOid), cached: true }
  const pending = captureBehaviorBaseline(cwd, spawnFn, asyncSpawnFn)
  cache.set(baseOid, pending)
  try {
    const baseline = await pending
    cache.set(baseOid, baseline)
    return { baseline, cached: false }
  } catch (error) {
    cache.delete(baseOid)
    throw error
  }
}

/**
 * Додає до Git-state validation test script із репозиторію і changelog gate.
 * Саме ці докази вирішують, чи приймати min-результат або ескалювати на max.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {{tests:{status:number,stdout:string,stderr:string}|null}|null} [baseline] стан policy base гілки
 * @param {(stage:string)=>void} [onProgress] stage callback
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{ok:boolean,error?:string}>} validation
 */
export async function validateBehaviorState(
  cwd,
  spawnFn = spawnSync,
  baseline = null,
  onProgress = noop,
  asyncSpawnFn = null
) {
  const gitState = validateGitState(cwd, spawnFn)
  if (!gitState.ok) return gitState
  const projectGates = await validateScopedProjectGates(cwd, spawnFn, onProgress, asyncSpawnFn)
  if (!projectGates.ok) return projectGates
  const postGateGitState = validateGitState(cwd, spawnFn)
  if (!postGateGitState.ok) return postGateGitState

  const packageJsonPath = join(cwd, 'package.json')
  if (existsSync(packageJsonPath)) {
    const packageJson = parseJson(readFileSync(packageJsonPath, 'utf8'), {})
    if (packageJson?.scripts?.test) {
      onProgress('project tests')
      const tests = await runAsync('bun', ['run', 'test'], cwd, resolveAsyncSpawn(spawnFn, asyncSpawnFn), {
        allowFailure: true
      })
      if (!acceptsTestOutcome(baseline?.tests ?? null, tests)) {
        return { ok: false, error: `bun run test: ${tests.stderr || tests.stdout}` }
      }
    }
  }

  onProgress('changelog')
  const changelog = await runAsync(
    'npx',
    ['@7n/rules', 'lint', 'changelog', '--no-fix'],
    cwd,
    resolveAsyncSpawn(spawnFn, asyncSpawnFn),
    { allowFailure: true }
  )
  if (changelog.status !== 0) {
    return {
      ok: false,
      error: `changelog gate: ${changelog.stderr || changelog.stdout}`,
      remediation: 'canonical-fixers'
    }
  }
  return { ok: true }
}

/**
 * Фінальний domain gate охоплює non-code зміни, зокрема workflows, dependency
 * manifests і правила. Code directories уже пройшли scoped lint і tests.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{ok:boolean,error?:string}>} gate
 */
export async function validateFinalProjectGates(cwd, spawnFn = spawnSync, asyncSpawnFn = null) {
  const longRunner = resolveAsyncSpawn(spawnFn, asyncSpawnFn)
  const lockfiles = await validateChangedLockfiles(cwd, spawnFn, asyncSpawnFn)
  if (!lockfiles.ok) return lockfiles
  for (const path of changedNonCodeDirectories(cwd, spawnFn)) {
    const lint = await runAsync('npx', ['@7n/rules', 'lint', '--path', path, '--no-fix'], cwd, longRunner, {
      allowFailure: true
    })
    if (lint.status !== 0) {
      return {
        ok: false,
        error: `domain lint (${path}): ${lint.stderr || lint.stdout}`,
        remediation: 'canonical-fixers'
      }
    }
  }
  const changelog = await runAsync('npx', ['@7n/rules', 'lint', 'changelog', '--no-fix'], cwd, longRunner, {
    allowFailure: true
  })
  if (changelog.status !== 0) {
    return {
      ok: false,
      error: `changelog gate: ${changelog.stderr || changelog.stdout}`,
      remediation: 'canonical-fixers'
    }
  }
  return { ok: true }
}

/**
 * Перевіряє final Bun lock state навіть коли node_modules уже існує.
 * Baseline install не є доказом валідності lockfile після apply/remediation.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {CommandRunner|null} [asyncSpawnFn] async runner
 * @returns {Promise<{ok:boolean,error?:string,remediation?:string}>} gate
 */
export async function validateChangedLockfiles(cwd, spawnFn = spawnSync, asyncSpawnFn = null) {
  if (!existsSync(join(cwd, 'package.json')) || !existsSync(join(cwd, 'bun.lock'))) return { ok: true }
  const paths = changedPaths(cwd, spawnFn)
  if (!paths.includes('bun.lock')) return { ok: true }
  const frozen = await runAsync(
    'bun',
    ['install', '--frozen-lockfile'],
    cwd,
    resolveAsyncSpawn(spawnFn, asyncSpawnFn),
    { allowFailure: true }
  )
  if (frozen.status === 0) return { ok: true }
  return {
    ok: false,
    error: `bun install --frozen-lockfile: ${frozen.stderr || frozen.stdout}`,
    remediation: 'bun-lockfile'
  }
}

/**
 * Просить LLM розв'язати лише вже матеріалізований конфлікт.
 * @param {object} args контекст
 * @returns {Promise<void>}
 */
async function resolveConflict(args) {
  const { runner, source, worktreeCwd, deps, spawnFn, log, onProgress = noop } = args
  const unresolved = unresolvedFiles(worktreeCwd, spawnFn)
  const prompt = [
    `У worktree ${worktreeCwd} JS уже застосував ${source} до свіжої policy base гілки.`,
    `Розв'яжи лише змістові конфлікти: ${unresolved.join(', ')}.`,
    'Порівняй current main та намір перенесеної зміни; не використовуй ours/theirs механічно.',
    'Збережи актуальну поведінку main, перенеси лише відсутню корисну частину.',
    'За потреби онови regression test. Не commit, не push, не створюй PR і не видаляй refs.',
    'Наприкінці прибери conflict markers і коротко наведи виконані перевірки.'
  ].join('\n\n')
  const outcome = await callWithValidatedFallback({
    runner,
    prompt,
    cwd: worktreeCwd,
    deps,
    log,
    label: `conflict ${source}`,
    onAttempt: ({ tier }) => onProgress('resolve conflict', tier),
    validate: () => validateGitState(worktreeCwd, spawnFn)
  })
  if (!outcome.ok) throw new Error(`LLM conflict resolution: ${outcome.error}`)
  git(['add', '-A'], worktreeCwd, spawnFn)
}

/**
 * Застосовує один branch group або stash у worktree.
 * @param {object} args контекст
 * @returns {Promise<void>}
 */
async function applySource(args) {
  const { source, sourceOid, commits, runner, rootCwd, worktreeCwd, deps, spawnFn, log, onProgress = noop } = args
  if (source.startsWith(SOURCE_BRANCH_PREFIX)) {
    for (const oid of commits) {
      const result = git(['cherry-pick', oid], worktreeCwd, spawnFn, { allowFailure: true })
      if (result.status === 0) continue
      if (unresolvedFiles(worktreeCwd, spawnFn).length === 0) {
        if (skipEmptyCherryPick(worktreeCwd, spawnFn)) continue
        throw new Error(`cherry-pick ${oid}: ${result.stderr || result.stdout}`)
      }
      await resolveConflict({ runner, source: oid, worktreeCwd, deps, spawnFn, log, onProgress })
      finishCherryPick(worktreeCwd, spawnFn)
    }
    return
  }

  const stashRef = source.slice(SOURCE_STASH_PREFIX.length)
  const patch = git(['stash', 'show', '-p', '--binary', sourceOid ?? stashRef], rootCwd, spawnFn).stdout
  const applied = git(['apply', '--3way', '-'], worktreeCwd, spawnFn, {
    allowFailure: true,
    input: patch
  })
  if (applied.status !== 0) {
    if (unresolvedFiles(worktreeCwd, spawnFn).length === 0) {
      throw new Error(`git apply ${stashRef}: ${applied.stderr || applied.stdout}`)
    }
    await resolveConflict({ runner, source: stashRef, worktreeCwd, deps, spawnFn, log, onProgress })
  }
}

/**
 * Делегує LLM лише behavioral verification/fix у вже зібраному worktree.
 * @param {object} args контекст
 * @returns {Promise<string>} текст відповіді
 */
async function finalizeBehavior(args) {
  const { runner, source, rationale, worktreeCwd, baseline, deps, spawnFn, log, onProgress = noop } = args
  const prompt = [
    `JS переніс ${source} на свіжу policy base гілку у ${worktreeCwd}.`,
    `Очікувана користь: ${rationale}`,
    'Перевір реальний diff і call sites. Доведи лише перенесену поведінку до готовності:',
    '- додай/онови regression test, якщо це bug fix;',
    '- виконай найвужчі релевантні тести;',
    '- не роби unrelated refactor або formatting churn.',
    'Не запускай full repository tests, doc generation, lint або changelog: після твоїх правок це детерміновано виконає JS.',
    'Не commit, не push, не створюй PR і не видаляй refs. Якщо поведінку неможливо безпечно підтвердити — нічого не маскуй, поверни чіткий blocker.'
  ].join('\n\n')
  const outcome = await callWithValidatedFallback({
    runner,
    prompt,
    cwd: worktreeCwd,
    deps,
    log,
    label: `behavior ${source}`,
    onAttempt: ({ tier }) => onProgress('behavior validation', tier),
    validate: () =>
      validateBehaviorState(
        worktreeCwd,
        spawnFn,
        baseline,
        step => onProgress(`behavior validation: ${step}`),
        deps.asyncSpawnFn
      ),
    remediate: validation =>
      remediateBehaviorState(
        worktreeCwd,
        spawnFn,
        validation,
        step => onProgress(`behavior validation: ${step}`),
        deps.asyncSpawnFn
      )
  })
  if (!outcome.ok) throw new Error(`LLM behavioral verification: ${outcome.error}`)
  return outcome.text.slice(0, PROMPT_TEXT_LIMIT)
}

/**
 * Нормалізує GitHub check/status до стабільного імені та стану.
 * @param {object} check statusCheckRollup або check-run
 * @returns {{name:string,state:'success'|'failure'|'pending'}} нормалізований check
 */
function normalizeGitHubCheck(check) {
  const name = check.name ?? check.context ?? check.workflowName ?? 'unnamed-check'
  const rawState = String(check.conclusion ?? check.state ?? check.status ?? '').toUpperCase()
  const successful = ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(rawState)
  const pending = ['', 'EXPECTED', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'REQUESTED', 'WAITING'].includes(rawState)
  let state = 'failure'
  if (successful) state = 'success'
  else if (pending) state = 'pending'
  return { name, state }
}

/**
 * Класифікує PR checks відносно checks base commit. Будь-який pending/unknown
 * стан fail-closed зберігає worktree; baseline-red дозволений лише коли кожен
 * failed check уже падає на base.
 * @param {object[]} prChecks PR statusCheckRollup
 * @param {object[]} baseChecks check-runs base commit
 * @returns {{status:'ready'|'pr-checks-regressed'|'pr-checks-baseline-red'|'pr-checks-unverified',error?:string}} класифікація
 */
export function classifyPullRequestChecks(prChecks, baseChecks) {
  if (prChecks.length === 0) {
    return {
      status: 'pr-checks-unverified',
      error: 'PR check rollup порожній: GitHub checks ще не зареєстровані'
    }
  }
  const normalizedPr = prChecks.map(check => normalizeGitHubCheck(check))
  const pending = normalizedPr.filter(check => check.state === 'pending')
  if (pending.length > 0) {
    return {
      status: 'pr-checks-unverified',
      error: `Незавершені PR checks: ${pending.map(check => check.name).join(', ')}`
    }
  }
  const failed = normalizedPr.filter(check => check.state === 'failure')
  if (failed.length === 0) return { status: 'ready' }

  const baseByName = new Map(
    baseChecks.map(check => normalizeGitHubCheck(check)).map(check => [check.name, check.state])
  )
  const regressions = failed.filter(check => baseByName.get(check.name) === 'success')
  if (regressions.length > 0) {
    return {
      status: 'pr-checks-regressed',
      error: `Failed PR checks були green на base: ${regressions.map(check => check.name).join(', ')}`
    }
  }
  const uncovered = failed.filter(check => !baseByName.has(check.name) || baseByName.get(check.name) === 'pending')
  if (uncovered.length > 0) {
    return {
      status: 'pr-checks-unverified',
      error: `Немає terminal base baseline для failed PR checks: ${uncovered.map(check => check.name).join(', ')}`
    }
  }
  return {
    status: 'pr-checks-baseline-red',
    error: `PR checks повторюють failed base checks: ${failed.map(check => check.name).join(', ')}`
  }
}

/**
 * Видаляє лише відновлювані dependencies зі збереженого forensic worktree.
 * Git metadata, commits і tracked/untracked зміни не зачіпаються.
 * @param {string} worktreeCwd шлях worktree
 * @returns {boolean} чи було що прибрати
 */
export function pruneForensicDependencies(worktreeCwd) {
  const dependencies = join(worktreeCwd, 'node_modules')
  if (!existsSync(dependencies)) return false
  try {
    rmSync(dependencies, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Чекає terminal CI state й порівнює failed checks з base commit.
 * @param {object} args PR context
 * @returns {Promise<{status:string,error?:string}>} readiness
 */
export async function verifyPullRequestReadiness(args) {
  const { url, cwd, spawnFn = spawnSync, asyncSpawnFn, delayFn = delay } = args
  const longRunner = resolveAsyncSpawn(spawnFn, asyncSpawnFn)
  await runAsync('gh', ['pr', 'checks', url, '--watch', '--interval', '10'], cwd, longRunner, {
    allowFailure: true,
    timeoutMs: PR_CHECK_TIMEOUT_MS
  })
  let view = await runAsync('gh', ['pr', 'view', url, '--json', 'statusCheckRollup,baseRefOid'], cwd, longRunner, {
    allowFailure: true
  })
  if (view.status !== 0) {
    return { status: 'pr-checks-unverified', error: `Не вдалося прочитати PR checks: ${view.stderr || view.error}` }
  }
  let pr = parseJson(view.stdout, null)
  if (pr && Array.isArray(pr.statusCheckRollup) && pr.statusCheckRollup.length === 0) {
    await delayFn(10_000)
    await runAsync('gh', ['pr', 'checks', url, '--watch', '--interval', '10'], cwd, longRunner, {
      allowFailure: true,
      timeoutMs: PR_CHECK_TIMEOUT_MS
    })
    view = await runAsync('gh', ['pr', 'view', url, '--json', 'statusCheckRollup,baseRefOid'], cwd, longRunner, {
      allowFailure: true
    })
    if (view.status !== 0) {
      return {
        status: 'pr-checks-unverified',
        error: `Не вдалося повторно прочитати PR checks: ${view.stderr || view.error}`
      }
    }
    pr = parseJson(view.stdout, null)
  }
  if (!pr || !Array.isArray(pr.statusCheckRollup) || !pr.baseRefOid) {
    return { status: 'pr-checks-unverified', error: 'GitHub повернув неповний PR check rollup' }
  }
  const repository = await runAsync(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    cwd,
    longRunner,
    { allowFailure: true }
  )
  if (repository.status !== 0 || !repository.stdout.trim()) {
    return { status: 'pr-checks-unverified', error: `Не вдалося визначити GitHub repository: ${repository.stderr}` }
  }
  const base = await runAsync(
    'gh',
    ['api', `repos/${repository.stdout.trim()}/commits/${pr.baseRefOid}/check-runs?per_page=100`],
    cwd,
    longRunner,
    { allowFailure: true }
  )
  if (base.status !== 0) {
    return { status: 'pr-checks-unverified', error: `Не вдалося прочитати base checks: ${base.stderr || base.error}` }
  }
  const basePayload = parseJson(base.stdout, null)
  if (!basePayload || !Array.isArray(basePayload.check_runs)) {
    return { status: 'pr-checks-unverified', error: 'GitHub повернув неповний base check rollup' }
  }
  return classifyPullRequestChecks(pr.statusCheckRollup, basePayload.check_runs)
}

/**
 * Запускає final gates і один canonical remediation pass.
 * @param {object} args gate context
 * @returns {Promise<{ok:boolean,error?:string}>} фінальний стан
 */
export async function passFinalProjectGates(args) {
  const { cwd, spawnFn, asyncSpawnFn, onProgress } = args
  let finalGates = await validateFinalProjectGates(cwd, spawnFn, asyncSpawnFn)
  if (finalGates.ok) return finalGates
  if (finalGates.remediation === 'bun-lockfile') {
    onProgress('synchronize final bun.lock')
    const synchronized = await runAsync(
      'bun',
      ['install', '--lockfile-only', '--ignore-scripts'],
      cwd,
      resolveAsyncSpawn(spawnFn, asyncSpawnFn),
      { allowFailure: true }
    )
    if (synchronized.status !== 0) {
      return { ok: false, error: `bun lockfile remediation: ${synchronized.stderr || synchronized.stdout}` }
    }
    return validateFinalProjectGates(cwd, spawnFn, asyncSpawnFn)
  }
  if (finalGates.remediation !== 'canonical-fixers') return finalGates

  onProgress('canonical final remediation')
  const remediation = await remediateBehaviorState(
    cwd,
    spawnFn,
    finalGates,
    step => onProgress(`canonical final remediation: ${step}`),
    asyncSpawnFn
  )
  if (!remediation.ok) return { ok: false, error: remediation.error ?? finalGates.error }
  finalGates = await validateFinalProjectGates(cwd, spawnFn, asyncSpawnFn)
  return finalGates
}

/**
 * Комітить лише зміни, які лишилися в index після final gates. Branch sources
 * можуть уже мати готові commits після cherry-pick, тому чистий index є
 * валідним станом і не потребує порожнього commit.
 * @param {string} cwd worktree
 * @param {string} title commit message
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {boolean} чи створено commit
 */
export function commitPendingChanges(cwd, title, spawnFn = spawnSync) {
  git(['add', '-A'], cwd, spawnFn)
  const staged =
    git(['diff', '--cached', '--quiet'], cwd, spawnFn, {
      allowFailure: true
    }).status !== 0
  if (!staged) return false
  git(['commit', '-m', title], cwd, spawnFn)
  return true
}

/**
 * Створює один готовий PR. При будь-якому провалі worktree лишається для
 * ручного відновлення; прибирається тільки після успішних CI checks.
 * @param {object} args параметри
 * @returns {Promise<{status:string,url?:string,branch?:string,error?:string,worktree?:string}>} результат
 */
async function createPullRequest(args) {
  const { candidate, group, runner, rootCwd, baselineCache, deps, spawnFn, log, onProgress = noop } = args
  const source = candidate.source
  const validCommitIds = new Set(candidate.commits?.map(commit => commit.oid))
  const commits = source.startsWith(SOURCE_BRANCH_PREFIX)
    ? (group.commits ?? []).filter(oid => validCommitIds.has(oid))
    : []
  if (source.startsWith(SOURCE_BRANCH_PREFIX) && commits.length === 0) {
    return { status: 'kept', error: 'LLM не вибрала жодного валідного commit oid' }
  }

  let worktree
  let createdPr
  try {
    onProgress('worktree')
    worktree = createReconcileWorktree(group.title, source, rootCwd, spawnFn)
    log(`🌿 ${source} → ${worktree.branch}`)
    const sourceMayChangeCode = (candidate.changedFiles ?? []).some(path => SOURCE_CODE_RE.test(path))
    let baseline = null
    if (sourceMayChangeCode) {
      onProgress('baseline tests')
      const captured = await captureCachedBehaviorBaseline(worktree.cwd, baselineCache, spawnFn, deps.asyncSpawnFn)
      baseline = captured.baseline
      if (captured.cached) onProgress('baseline tests (cached)')
    }
    onProgress('apply')
    await applySource({
      source,
      sourceOid: candidate.oid,
      commits,
      runner,
      rootCwd,
      worktreeCwd: worktree.cwd,
      deps,
      spawnFn,
      log,
      onProgress
    })
    const appliedOutcome = discardPatchEquivalentWorktree({ worktree, rootCwd, spawnFn, onProgress })
    if (appliedOutcome) return appliedOutcome
    const verification =
      changedSourceDirectories(worktree.cwd, spawnFn).length > 0
        ? await finalizeBehavior({
            runner,
            source,
            rationale: group.rationale ?? candidate.rationale ?? '',
            worktreeCwd: worktree.cwd,
            baseline,
            deps,
            spawnFn,
            log,
            onProgress
          })
        : NO_CODE_VERIFICATION
    onProgress('Git validation')
    const unresolved = unresolvedFiles(worktree.cwd, spawnFn)
    if (unresolved.length > 0) throw new Error(`Нерозв'язані конфлікти: ${unresolved.join(', ')}`)
    git(['diff', '--check'], worktree.cwd, spawnFn)
    git(['add', '-A'], worktree.cwd, spawnFn)
    const validatedOutcome = discardPatchEquivalentWorktree({
      worktree,
      rootCwd,
      spawnFn,
      onProgress,
      validated: true
    })
    if (validatedOutcome) return validatedOutcome
    onProgress('delta lint')
    const finalGates = await passFinalProjectGates({
      cwd: worktree.cwd,
      spawnFn,
      asyncSpawnFn: deps.asyncSpawnFn,
      onProgress
    })
    if (!finalGates.ok) throw new Error(finalGates.error)
    git(['add', '-A'], worktree.cwd, spawnFn)
    const finalOutcome = discardPatchEquivalentWorktree({
      worktree,
      rootCwd,
      spawnFn,
      onProgress,
      validated: true
    })
    if (finalOutcome) return finalOutcome
    commitPendingChanges(worktree.cwd, group.title, spawnFn)
    const baseRef = policyBaseRef(worktree.cwd)
    const baseBranch = readGitPolicy(worktree.cwd).baseBranch
    git(['diff', '--check', `${baseRef}...HEAD`], worktree.cwd, spawnFn)
    const describePr = deps.describePullRequest ?? describePullRequest
    const body = await describePr({
      runner,
      cwd: worktree.cwd,
      baseRef,
      source,
      title: group.title,
      rationale: group.rationale ?? candidate.rationale ?? '',
      verification,
      deps,
      spawnFn,
      log,
      onProgress
    })
    onProgress('push')
    git(['push', '-u', 'origin', worktree.branch], worktree.cwd, spawnFn)

    onProgress('create PR')
    createdPr = run(
      'gh',
      ['pr', 'create', '--base', baseBranch, '--head', worktree.branch, '--title', group.title, '--body', body],
      worktree.cwd,
      spawnFn
    ).stdout.trim()
    onProgress('PR checks')
    const readinessVerifier = deps.verifyPullRequestReadiness ?? verifyPullRequestReadiness
    const readiness = await readinessVerifier({
      url: createdPr,
      cwd: worktree.cwd,
      spawnFn,
      asyncSpawnFn: deps.asyncSpawnFn
    })
    if (readiness.status !== 'ready') {
      onProgress('prune forensic dependencies')
      pruneForensicDependencies(worktree.cwd)
      return {
        status: readiness.status,
        error: readiness.error,
        url: createdPr,
        branch: worktree.branch,
        worktree: worktree.cwd
      }
    }
    onProgress('remove worktree')
    removeReconcileWorktree(worktree, rootCwd, spawnFn)
    return { status: 'pr-created', url: createdPr, branch: worktree.branch }
  } catch (error) {
    const setup = /** @type {{branch?:string,worktree?:string}} */ (error)
    if (worktree?.cwd) {
      onProgress('prune forensic dependencies')
      pruneForensicDependencies(worktree.cwd)
    }
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      branch: worktree?.branch ?? setup.branch,
      worktree: worktree?.cwd ?? setup.worktree,
      ...(createdPr && { url: createdPr })
    }
  }
}

/**
 * Прибирає stale unlocked records і підтверджує фактичне зникнення записів.
 * @param {object[]} worktrees worktree inventory
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {Array<{path:string,status:string,error?:string}>} outcomes
 */
function pruneStaleWorktrees(worktrees, rootCwd, spawnFn) {
  const prunable = worktrees.filter(worktree => worktree.prunable && !worktree.locked)
  if (prunable.length === 0) return []
  const pruned = git(['worktree', 'prune'], rootCwd, spawnFn, { allowFailure: true })
  const remaining =
    pruned.status === 0
      ? new Set(
          parseWorktreeInventory(
            git(['worktree', 'list', '--porcelain'], rootCwd, spawnFn, { allowFailure: true }).stdout
          ).map(worktree => worktree.path)
        )
      : new Set(prunable.map(worktree => worktree.path))
  return prunable.map(worktree => {
    const removed = pruned.status === 0 && !remaining.has(worktree.path)
    return {
      path: worktree.path,
      status: removed ? 'pruned' : 'cleanup-failed',
      ...(!removed && { error: pruned.stderr || pruned.stdout || 'record лишився після git worktree prune' })
    }
  })
}

/**
 * @param {object} worktree worktree record
 * @returns {boolean} чи дозволена automatic removal policy
 */
function removableWorktreeShape(worktree) {
  const protectedState =
    worktree.prunable || worktree.current || worktree.locked || worktree.protected || !worktree.managed
  return !protectedState && worktree.dirty === false
}

/**
 * @param {object} worktree worktree record
 * @param {object[]} branches branch inventory
 * @returns {object[]} refs, які відповідають checkout
 */
function branchesForWorktree(worktree, branches) {
  return branches.filter(branch => {
    return branch.worktree === worktree.path || (worktree.head && branch.oid === worktree.head)
  })
}

/**
 * @param {object} worktree worktree record
 * @param {object[]} matchingBranches відповідні refs
 * @param {object} inventory repository inventory
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {boolean} чи checkout доведено inactive
 */
function isInactiveWorktree(worktree, matchingBranches, inventory, rootCwd, spawnFn) {
  if (matchingBranches.some(branch => branch.pr)) return false
  const inactiveByBranch =
    matchingBranches.length > 0 &&
    matchingBranches.every(branch => ['merged', 'patch-equivalent'].includes(branch.state))
  if (inactiveByBranch) return true
  if (!worktree.head) return false
  return (
    git(['merge-base', '--is-ancestor', worktree.head, inventory.base], rootCwd, spawnFn, {
      allowFailure: true
    }).status === 0
  )
}

/**
 * @param {object} worktree worktree record
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{status:number,stdout:string,stderr:string}} command result
 */
function removeTransientWorktree(worktree, rootCwd, spawnFn) {
  const branch = worktree.branch ? branchName(worktree.branch) : null
  if (branch && worktree.path.includes('/.worktrees/')) {
    return run('npx', ['@7n/mt', 'worktree', 'remove', branch], rootCwd, spawnFn, { allowFailure: true })
  }
  return git(['worktree', 'remove', worktree.path], rootCwd, spawnFn, { allowFailure: true })
}

/**
 * Прибирає лише stale records або clean inactive worktree у transient
 * namespaces. Dirty/current/locked/protected/open-PR і унікальні worktree
 * залишаються недоторканими.
 * @param {object} inventory зібраний Git inventory
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {Array<{path:string,status:string,error?:string}>} cleanup outcomes
 */
export function cleanupObsoleteWorktrees(inventory, rootCwd, spawnFn = spawnSync) {
  const worktrees = inventory.worktrees ?? []
  const outcomes = pruneStaleWorktrees(worktrees, rootCwd, spawnFn)
  if ((inventory.warnings ?? []).length > 0) return outcomes
  const removable = worktrees.filter(worktree => removableWorktreeShape(worktree))
  for (const worktree of removable) {
    const matchingBranches = branchesForWorktree(worktree, inventory.branches)
    if (!isInactiveWorktree(worktree, matchingBranches, inventory, rootCwd, spawnFn)) continue
    const removed = removeTransientWorktree(worktree, rootCwd, spawnFn)
    const status = removed.status === 0 ? 'removed' : 'cleanup-failed'
    outcomes.push({
      path: worktree.path,
      status,
      ...(status !== 'removed' && { error: removed.stderr || removed.stdout })
    })
    if (status === 'removed') {
      for (const candidate of matchingBranches) candidate.worktree = null
    }
  }
  return outcomes
}

/**
 * Видаляє точний source після Git-доказу неактуальності або успішного
 * перенесення. Protected/open-PR refs не потрапляють у цей крок.
 * @param {object} candidate inventory source
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{status:string,error?:string}} cleanup result
 */
export function cleanupSource(candidate, rootCwd, spawnFn = spawnSync) {
  try {
    if (candidate.source.startsWith(SOURCE_STASH_PREFIX)) {
      const rows = git(['stash', 'list', '--format=%gd%x00%H'], rootCwd, spawnFn)
        .stdout.split('\n')
        .filter(Boolean)
        .map(line => line.split('\0'))
      const row = rows.find(([, oid]) => oid === candidate.oid)
      if (!row) return { status: 'already-removed', removedRefs: [] }
      git(['stash', 'drop', row[0]], rootCwd, spawnFn)
      return { status: 'removed', removedRefs: [row[0]] }
    }

    const removedRefs = []
    for (const ref of candidate.aliases ?? [candidate.ref]) {
      if (ref.startsWith('refs/remotes/origin/')) {
        const remote = git(['ls-remote', '--exit-code', '--heads', 'origin', branchName(ref)], rootCwd, spawnFn, {
          allowFailure: true
        })
        if (remote.status !== 0) continue
        git(['push', 'origin', '--delete', branchName(ref)], rootCwd, spawnFn)
      } else if (ref.startsWith('refs/heads/')) {
        const local = git(['show-ref', '--verify', '--quiet', ref], rootCwd, spawnFn, { allowFailure: true })
        if (local.status !== 0) continue
        git(['branch', '-D', branchName(ref)], rootCwd, spawnFn)
      }
      removedRefs.push(ref)
    }
    return { status: 'removed', removedRefs }
  } catch (error) {
    return {
      status: 'cleanup-failed',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Форматує aliases, які cleanup фактично видалив.
 * @param {object|undefined} cleanup cleanup result
 * @returns {string} report suffix
 */
function formatRemovedRefs(cleanup) {
  if (!cleanup?.removedRefs?.length) return ''
  const refs = cleanup.removedRefs.map(ref => `\`${ref}\``).join(',')
  return `; refs=${refs}`
}

/**
 * Рахує точні outcomes без змішування створеного PR з CI-ready PR.
 * @param {Array<{status:string}>} results результати materialization
 * @returns {string} стабільний summary
 */
export function formatOutcomeCounts(results) {
  const counts = new Map()
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1)
  return counts
    .keys()
    .toArray()
    .toSorted((left, right) => left.localeCompare(right))
    .map(status => `${status}=${counts.get(status)}`)
    .join(', ')
}

/**
 * @param {object|undefined} cleanup cleanup outcome
 * @returns {boolean} чи source доведено видалений
 */
function cleanupRemoved(cleanup) {
  return ['removed', 'already-removed'].includes(cleanup?.status)
}

/**
 * @param {Map<string,number>} counts reason counters
 * @param {string} reason reason key
 */
function incrementReason(counts, reason) {
  counts.set(reason, (counts.get(reason) ?? 0) + 1)
}

/**
 * @param {Map<string,number>} counts reason counters
 * @returns {string} stable counts
 */
function formatReasonCounts(counts) {
  return counts
    .keys()
    .toArray()
    .toSorted((left, right) => left.localeCompare(right))
    .map(reason => `${reason}=${counts.get(reason)}`)
    .join(', ')
}

/**
 * Додає forensic worktrees, створені вже після початкового inventory.
 * Наявність path у result означає, що lifecycle навмисно лишив checkout.
 * @param {Array<object>} worktrees початкові worktrees
 * @param {Array<object>} results materialization outcomes
 * @returns {Array<object>} повний фактичний набір
 */
function appendMaterializedWorktrees(worktrees, results) {
  const remaining = [...worktrees]
  const knownPaths = new Set(remaining.map(worktree => worktree.path))
  for (const result of results) {
    if (!result.worktree || knownPaths.has(result.worktree)) continue
    knownPaths.add(result.worktree)
    remaining.push({
      path: result.worktree,
      branch: result.branch,
      retentionReason: result.status
    })
  }
  return remaining
}

/**
 * @param {object} branch branch inventory
 * @returns {string[]} normalized branch names
 */
function branchIdentityNames(branch) {
  return [branch.name, branch.ref, ...(branch.aliases ?? [])].filter(Boolean).map(ref => branchName(ref))
}

/**
 * Додає PR/forensic branches, створені після початкового inventory.
 * Patch-equivalent lifecycle успішно видаляє свій transient worktree/branch.
 * @param {Array<object>} branches початкові branches
 * @param {Array<object>} results materialization outcomes
 * @returns {Array<object>} повний фактичний набір
 */
function appendMaterializedBranches(branches, results) {
  const remaining = [...branches]
  const knownNames = new Set(remaining.flatMap(branch => branchIdentityNames(branch)))
  for (const result of results) {
    if (!result.branch || result.status === 'patch-equivalent' || knownNames.has(result.branch)) continue
    knownNames.add(result.branch)
    remaining.push({
      source: `materialized:${result.branch}`,
      ref: `refs/heads/${result.branch}`,
      name: result.branch,
      state: result.status,
      worktree: result.worktree,
      pr: result.url ? { url: result.url } : null,
      retentionReason: result.status
    })
  }
  return remaining
}

/**
 * Рахує sources/worktrees, які реально лишилися після cleanup, і пояснює
 * retention окремо для Git sources та checkout-ів.
 * @param {{inventory:object,results:Array<object>}} args report state
 * @returns {{branches:number,stashes:number,worktrees:number,sourceReasons:string,worktreeReasons:string}} summary
 */
export function summarizeRemaining({ inventory, results }) {
  const resultsBySource = Map.groupBy(results, result => result.source)
  const removedByResult = source => (resultsBySource.get(source) ?? []).some(result => cleanupRemoved(result.cleanup))
  const removedPaths = new Set(
    (inventory.worktreeCleanup ?? [])
      .filter(worktree => ['removed', 'pruned'].includes(worktree.status))
      .map(worktree => worktree.path)
  )
  const remainingWorktrees = appendMaterializedWorktrees(
    (inventory.worktrees ?? []).filter(worktree => !removedPaths.has(worktree.path)),
    results
  )
  const remainingBranches = appendMaterializedBranches(
    (inventory.branches ?? []).filter(branch => {
      return !cleanupRemoved(branch.cleanup) && !removedByResult(branch.source)
    }),
    results
  )
  const remainingStashes = (inventory.stashes ?? []).filter(stash => {
    return !cleanupRemoved(stash.cleanup) && !removedByResult(stash.source)
  })
  const sourceReasons = new Map()
  for (const branch of remainingBranches) {
    const worktree = remainingWorktrees.find(item => item.path === branch.worktree)
    const result = (resultsBySource.get(branch.source) ?? []).find(item => !cleanupRemoved(item.cleanup))
    let reason = branch.retentionReason ?? result?.status ?? branch.state
    if (branch.pr) reason = 'open-pr'
    else if (worktree?.current) reason = 'current-worktree'
    else if (worktree?.dirty) reason = 'dirty-worktree'
    incrementReason(sourceReasons, reason)
  }
  for (const stash of remainingStashes) {
    const result = (resultsBySource.get(stash.source) ?? []).find(item => !cleanupRemoved(item.cleanup))
    incrementReason(sourceReasons, result?.status ?? stash.state)
  }
  const worktreeReasons = new Map()
  for (const worktree of remainingWorktrees) {
    const matchingBranches = remainingBranches.filter(branch => branch.worktree === worktree.path)
    let reason = worktree.retentionReason ?? 'unique-or-unclassified'
    if (worktree.current) reason = 'current'
    else if (worktree.dirty) reason = 'dirty'
    else if (worktree.locked) reason = 'locked'
    else if (worktree.protected) reason = 'protected'
    else if (matchingBranches.some(branch => branch.pr)) reason = 'open-pr'
    incrementReason(worktreeReasons, reason)
  }
  return {
    branches: remainingBranches.length,
    stashes: remainingStashes.length,
    worktrees: remainingWorktrees.length,
    sourceReasons: formatReasonCounts(sourceReasons),
    worktreeReasons: formatReasonCounts(worktreeReasons)
  }
}

/**
 * @param {object} branch inventory branch
 * @returns {string|null} report line
 */
function formatBranchReport(branch) {
  if (branch.state === 'review') return null
  let suffix = ''
  if (branch.pr?.url) suffix = ` — ${branch.pr.url}`
  else if (branch.worktree) suffix = ` — ${branch.worktree}`
  const cleanupOid = branch.oid ? `; oid=${branch.oid}` : ''
  const removedRefs = formatRemovedRefs(branch.cleanup)
  const cleanup = branch.cleanup ? `; cleanup=${branch.cleanup.status}${cleanupOid}${removedRefs}` : ''
  return `- \`${branch.source ?? branch.name}\`: ${branch.state}${cleanup}${suffix}`
}

/**
 * @param {object} result materialization result
 * @returns {string} report line
 */
function formatResultReport(result) {
  const details = [result.url, result.error, result.rationale, result.worktree && `worktree=${result.worktree}`].filter(
    Boolean
  )
  const suffix = details.length > 0 ? ` — ${details.join('; ')}` : ''
  const cleanupOid = result.oid ? `; oid=${result.oid}` : ''
  const removedRefs = formatRemovedRefs(result.cleanup)
  const cleanup = result.cleanup ? `; cleanup=${result.cleanup.status}${cleanupOid}${removedRefs}` : ''
  return `- \`${result.source}\`: ${result.status}${cleanup}${suffix}`
}

/**
 * @param {object} stash inventory stash
 * @returns {string|null} report line
 */
function formatStashReport(stash) {
  if (stash.state === 'review') return null
  const cleanupOid = stash.oid ? `; oid=${stash.oid}` : ''
  const removedRefs = formatRemovedRefs(stash.cleanup)
  const cleanup = stash.cleanup ? `; cleanup=${stash.cleanup.status}${cleanupOid}${removedRefs}` : ''
  const equivalence = stash.equivalence ? ` — ${stash.equivalence}` : ''
  return `- \`${stash.source}\`: ${stash.state}${cleanup}${equivalence}`
}

/**
 * Формує deterministic report.
 * @param {{inventory:object,results:Array<object>}} args дані
 * @returns {string} markdown
 */
export function formatReport({ inventory, results }) {
  const remaining = summarizeRemaining({ inventory, results })
  const lines = [
    '## git-reconcile: підсумок',
    `- Outcomes: ${formatOutcomeCounts(results) || 'none'}`,
    `- Remaining: branches=${remaining.branches}, worktrees=${remaining.worktrees}, stashes=${remaining.stashes}`,
    `- Remaining source reasons: ${remaining.sourceReasons || 'none'}`,
    `- Remaining worktree reasons: ${remaining.worktreeReasons || 'none'}`
  ]
  for (const worktree of inventory.worktreeCleanup ?? []) {
    const detail = worktree.error ? ` — ${worktree.error}` : ''
    lines.push(`- worktree \`${worktree.path}\`: ${worktree.status}${detail}`)
  }
  lines.push(
    ...inventory.branches.map(branch => formatBranchReport(branch)).filter(Boolean),
    ...(inventory.stashes ?? []).map(stash => formatStashReport(stash)).filter(Boolean),
    ...results.map(result => formatResultReport(result))
  )
  for (const warning of inventory.warnings) lines.push(`- ⚠️ ${warning}`)
  return lines.join('\n')
}

/**
 * Повертає fail-closed keep-рішення для всього batch.
 * @param {Array<object>} batch candidates
 * @param {string} error validation/runner error
 * @returns {Array<object>} keep decisions
 */
function failedTriageDecisions(batch, error) {
  return batch.map(candidate => ({
    source: candidate.source,
    action: 'keep',
    rationale: `LLM triage failed: ${error}`,
    incomplete: true,
    groups: []
  }))
}

/**
 * Виконує min→validation→max triage по bounded batches.
 * @param {object} args orchestration context
 * @returns {Promise<Array<object>>} decisions
 */
async function triageCandidates(args) {
  const { candidates, runner, task, rootCwd, deps, log, progress } = args
  const decisions = []
  for (let offset = 0; offset < candidates.length; offset += REVIEW_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + REVIEW_BATCH_SIZE)
    const key = `triage-${offset}`
    const detail = `${offset + 1}-${offset + batch.length}/${candidates.length}`
    progress.step(key, detail)
    let outcome
    try {
      outcome = await callWithValidatedFallback({
        runner,
        prompt: buildTriagePrompt(batch, task),
        cwd: rootCwd,
        deps,
        log,
        label: `triage ${detail}`,
        onAttempt: ({ tier }) => progress.step(key, detail, tier),
        validate: result => validateTriageOutcome(result, batch)
      })
    } finally {
      progress.done(key)
    }
    if (outcome.ok) decisions.push(...outcome.validation.value.decisions)
    else decisions.push(...failedTriageDecisions(batch, outcome.error))
  }
  return decisions
}

/**
 * Матеріалізує одну PR-групу з наперед визначеним progress index.
 * @param {object} args orchestration context
 * @returns {Promise<object>} result одного source/group
 */
async function materializePrGroup(args) {
  const {
    decision,
    candidate,
    group,
    prIndex,
    prTotal,
    runner,
    rootCwd,
    baselineCache,
    deps,
    spawnFn,
    log,
    createPr,
    progress
  } = args
  const key = `pr-${prIndex}`
  const prefix = `${prIndex}/${prTotal} · ${decision.source}`
  progress.step(key, `${prefix} · worktree`)
  try {
    const result = await createPr({
      candidate: { ...candidate, rationale: decision.rationale },
      group,
      runner,
      rootCwd,
      baselineCache,
      deps,
      spawnFn,
      log,
      onProgress: (step, tier) => progress.step(key, `${prefix} · ${step}`, tier)
    })
    return {
      source: decision.source,
      ...(candidate.oid && { oid: candidate.oid }),
      ...result
    }
  } finally {
    progress.done(key)
  }
}

/**
 * Виконує async jobs із bounded concurrency та стабільним порядком output.
 * @param {Array<()=>Promise<object>>} jobs jobs
 * @param {number} concurrency одночасні jobs
 * @returns {Promise<object[]>} результати в порядку jobs
 */
export async function runWithConcurrency(jobs, concurrency) {
  const results = Array.from({ length: jobs.length })
  let next = 0
  /** Виконує наступні jobs до вичерпання спільної черги. */
  async function worker() {
    while (next < jobs.length) {
      const index = next
      next += 1
      results[index] = await jobs[index]()
    }
  }
  const workerCount = Math.min(jobs.length, Math.max(1, concurrency))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * Нормалізує bounded concurrency PR-фази.
 * @param {unknown} value override/env value
 * @returns {number} 1..MAX_PR_CONCURRENCY
 */
export function normalizePrConcurrency(value) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_PR_CONCURRENCY
  return Math.min(MAX_PR_CONCURRENCY, Math.max(1, parsed))
}

/**
 * Перетворює validated decisions у PR/keep/drop results. Незалежні PR-групи
 * виконуються паралельно з bounded concurrency, cleanup стартує лише після
 * завершення всіх jobs.
 * @param {object} args orchestration context
 * @returns {Promise<{bySource:Map<string,object>,results:Array<object>}>} materialized state
 */
async function materializeDecisions(args) {
  const { decisions, candidates, prConcurrency, prTotal } = args
  const bySource = new Map(candidates.map(candidate => [candidate.source, candidate]))
  const resultSlots = []
  const jobs = []
  let prIndex = 0
  for (const decision of decisions) {
    const candidate = bySource.get(decision.source)
    if (!candidate) continue
    if (decision.action !== 'pr') {
      resultSlots.push({
        source: decision.source,
        status: decision.action === 'drop' ? 'drop-recommended' : 'kept',
        rationale: decision.rationale ?? '',
        ...(decision.incomplete === true && { incomplete: true }),
        ...(candidate.oid && { oid: candidate.oid })
      })
      continue
    }
    for (const group of decision.groups) {
      prIndex += 1
      const fixedIndex = prIndex
      const resultIndex = resultSlots.length
      resultSlots.push(null)
      jobs.push(async () => {
        resultSlots[resultIndex] = await materializePrGroup({
          ...args,
          decision,
          candidate,
          group,
          prIndex: fixedIndex,
          prTotal
        })
        return resultSlots[resultIndex]
      })
    }
  }
  await runWithConcurrency(jobs, prConcurrency)
  return { bySource, results: resultSlots.filter(Boolean) }
}

/**
 * Прибирає Git-доведені merged/patch-equivalent branches і stashes.
 * @param {object} args cleanup context
 */
function cleanupInactiveSources(args) {
  const { inventory, cleanup, rootCwd, spawnFn, progress, cleanupState } = args
  const inactiveSources = [
    ...inventory.branches.filter(source => {
      return ['merged', 'patch-equivalent'].includes(source.state) && !source.worktree && !source.pr
    }),
    ...(inventory.stashes ?? []).filter(source => source.state === 'patch-equivalent')
  ]
  for (const source of inactiveSources) {
    cleanupState.index += 1
    const key = `cleanup-${cleanupState.index}`
    progress.step(key, source.source)
    try {
      source.cleanup = cleanup(source, rootCwd, spawnFn)
    } finally {
      progress.done(key)
    }
  }
}

/**
 * Прибирає source лише після drop або успіху всіх його PR groups.
 * @param {object} args cleanup context
 */
function cleanupMaterializedSources(args) {
  const { bySource, results, cleanup, rootCwd, spawnFn, progress, cleanupState } = args
  for (const [source, candidate] of bySource) {
    const sourceResults = results.filter(result => result.source === source)
    const dropped = sourceResults.some(result => result.status === 'drop-recommended')
    const allTransferred =
      sourceResults.length > 0 &&
      sourceResults.every(result => ['pr-created', 'patch-equivalent'].includes(result.status))
    if (!dropped && !allTransferred) continue
    cleanupState.index += 1
    const key = `cleanup-${cleanupState.index}`
    progress.step(key, source)
    try {
      const cleanupResult = cleanup(candidate, rootCwd, spawnFn)
      for (const result of sourceResults) result.cleanup = cleanupResult
    } finally {
      progress.done(key)
    }
  }
}

/**
 * Рахує точний cleanup total після завершення PR-фази.
 * @param {object} inventory Git inventory
 * @param {Map<string,object>} bySource review sources
 * @param {Array<object>} results результати PR-фази
 * @returns {number} кількість sources
 */
function countCleanupSources(inventory, bySource, results) {
  const inactive = inventory.branches.filter(branch => {
    return ['merged', 'patch-equivalent'].includes(branch.state) && !branch.worktree && !branch.pr
  }).length
  const inactiveStashes = (inventory.stashes ?? []).filter(stash => stash.state === 'patch-equivalent').length
  const reviewed = bySource
    .keys()
    .filter(source => {
      const sourceResults = results.filter(result => result.source === source)
      const dropped = sourceResults.some(result => result.status === 'drop-recommended')
      const allTransferred =
        sourceResults.length > 0 &&
        sourceResults.every(result => ['pr-created', 'patch-equivalent'].includes(result.status))
      return dropped || allTransferred
    })
    .toArray().length
  return inactive + inactiveStashes + reviewed
}

/**
 * JS-оркестратор: inventory → bounded LLM triage → deterministic PR pipeline.
 * @param {{cwd?:string,runner?:'pi'|'cursor'|'codex',task?:string,log?:(line:string)=>void,isTTY?:boolean,deps?:object}} [options] опції
 * @returns {Promise<{ok:boolean,report:string,inventory:object,results:Array<object>}>} результат
 */
export async function runGitReconcileOrchestrator(options = {}) {
  const rootCwd = options.cwd ?? process.cwd()
  const runner = options.runner ?? 'pi'
  const task = options.task ?? ''
  const log = options.log ?? (line => console.log(line))
  const deps = options.deps ?? {}
  const spawnFn = deps.spawnFn ?? spawnSync
  const inventoryFn = deps.inventoryRepository ?? inventoryRepository
  const createPr = deps.createPullRequest ?? createPullRequest
  const cleanup = deps.cleanupSource ?? cleanupSource
  const cleanupWorktrees = deps.cleanupObsoleteWorktrees ?? cleanupObsoleteWorktrees
  const now = deps.now ?? (() => performance.now())
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const heartbeatMs = deps.heartbeatMs ?? PROGRESS_HEARTBEAT_MS
  const prConcurrency = normalizePrConcurrency(deps.prConcurrency ?? env.N_GIT_RECONCILE_CONCURRENCY)
  const baselineCache = new Map()

  const inventoryStartedAt = now()
  log('⏳ етап 1/4: inventory')
  const inventory = inventoryFn(rootCwd, { spawnFn })
  if (deps.ensureLocalWorktreeExclude !== false) {
    const ensureExclude = deps.ensureLocalWorktreeExclude ?? ensureLocalWorktreeExclude
    if (ensureExclude(rootCwd, spawnFn)) log('🛡️ Додано `.worktrees/` до локального `.git/info/exclude`')
  }
  const candidates = [...inventory.branches, ...inventory.stashes].filter(item => item.state === 'review')
  log(
    `✅ етап 1/4: inventory · ${elapsedLabel(inventoryStartedAt, now)} · ${inventory.branches.length} branches · ${inventory.stashes.length} stash`
  )

  const triageTotal = Math.ceil(candidates.length / REVIEW_BATCH_SIZE)
  const triageProgress = createPhaseProgress({
    total: triageTotal,
    unitLabel: 'triage-пакетів',
    phase: 'етап 2/4: triage',
    log,
    now,
    heartbeatMs,
    setIntervalFn,
    clearIntervalFn
  })
  const triageStartedAt = now()
  let decisions
  try {
    decisions = await triageCandidates({
      candidates,
      runner,
      task,
      rootCwd,
      deps,
      log,
      progress: triageProgress
    })
  } finally {
    triageProgress.stop()
  }
  log(`✅ етап 2/4: triage · ${elapsedLabel(triageStartedAt, now)} · ${triageTotal} batches`)

  const prTotal = decisions.reduce((total, decision) => {
    return total + (decision.action === 'pr' && Array.isArray(decision.groups) ? decision.groups.length : 0)
  }, 0)
  const prProgress = createPhaseProgress({
    total: prTotal,
    unitLabel: 'PR-груп',
    phase: 'етап 3/4: PR',
    log,
    now,
    heartbeatMs,
    setIntervalFn,
    clearIntervalFn
  })
  const prStartedAt = now()
  let materialized
  try {
    materialized = await materializeDecisions({
      decisions,
      candidates,
      runner,
      rootCwd,
      baselineCache,
      deps,
      spawnFn,
      log,
      createPr,
      progress: prProgress,
      prTotal,
      prConcurrency
    })
  } finally {
    prProgress.stop()
  }
  log(
    `✅ етап 3/4: PR · ${elapsedLabel(prStartedAt, now)} · ${prTotal} groups · ${formatOutcomeCounts(materialized.results) || 'none'}`
  )

  const { bySource, results } = materialized
  inventory.worktreeCleanup = cleanupWorktrees(inventory, rootCwd, spawnFn)
  const cleanupCount = countCleanupSources(inventory, bySource, results)
  const cleanupProgress = createPhaseProgress({
    total: cleanupCount,
    unitLabel: 'джерел',
    phase: 'етап 4/4: cleanup',
    log,
    now,
    heartbeatMs,
    setIntervalFn,
    clearIntervalFn
  })
  const cleanupStartedAt = now()
  const cleanupState = { index: 0 }
  try {
    cleanupInactiveSources({
      inventory,
      cleanup,
      rootCwd,
      spawnFn,
      progress: cleanupProgress,
      cleanupState
    })
    cleanupMaterializedSources({
      bySource,
      results,
      cleanup,
      rootCwd,
      spawnFn,
      progress: cleanupProgress,
      cleanupState
    })
  } finally {
    cleanupProgress.stop()
  }
  log(`✅ етап 4/4: cleanup · ${elapsedLabel(cleanupStartedAt, now)} · ${cleanupCount} sources`)

  const report = formatReport({ inventory, results })
  log(report)
  const blockingStatuses = new Set(['failed', 'pr-checks-regressed', 'pr-checks-baseline-red', 'pr-checks-unverified'])
  const ok = results.every(result => !blockingStatuses.has(result.status) && result.incomplete !== true)
  return { ok, report, inventory, results }
}
