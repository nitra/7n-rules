/** @see ./docs/orchestrate.md */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { env } from 'node:process'

import { renderProgressLine } from '../../../scripts/lib/lint-surface/progress.mjs'
import { readGitPolicy } from '../../../scripts/lib/git-policy.mjs'

const LLM_TIERS = ['min', 'max']
const REVIEW_BATCH_SIZE = 10
const PROMPT_TEXT_LIMIT = 12_000
const PROGRESS_HEARTBEAT_MS = 30_000
const DEFAULT_PR_CONCURRENCY = 3
const MAX_PR_CONCURRENCY = 4
const SOURCE_BRANCH_PREFIX = 'branch:'
const SOURCE_STASH_PREFIX = 'stash:'
const CONTENT_CONFLICT_RE = /^CONFLICT \(.+?\): Merge conflict in (.+)$/
const MODIFY_DELETE_CONFLICT_RE = /^CONFLICT \(modify\/delete\): (.+?) deleted in /
const REF_HEADS_RE = /^refs\/heads\//
const REF_ORIGIN_RE = /^refs\/remotes\/origin\//
const RENAME_DELETE_CONFLICT_RE = /^CONFLICT \(rename\/delete\): .+? renamed to (.+?) in .+?, but deleted/
const SOURCE_CODE_RE = /\.(?:js|mjs|ts|vue|rs|py)$/
const WHITESPACE_RE = /\s+/
const ACP_PROGRESS_ENV = 'N_LLM_ACP_PROGRESS'
const REF_INVENTORY_FORMAT = ['%(refname)', '%00', '%(object', 'name)', '%00', '%(committer', 'date:iso-strict)'].join(
  ''
)

/** Порожній callback для опційного progress log. */
function noop() {
  // Навмисно порожньо: caller не запросив progress output.
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
    error: result.error ? `${result.error.name ?? 'Error'}${result.error.code ? ` ${result.error.code}` : ''}: ${result.error.message}` : ''
  }
  if (!options.allowFailure && normalized.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} → exit ${normalized.status}: ${normalized.stderr || normalized.stdout || normalized.error}`
    )
  }
  return normalized
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
 * Парсить branch refs і всі checkout HEAD OID, включно з detached worktree.
 * @param {string} text porcelain
 * @returns {{branches:Map<string,string>,commits:Map<string,string>}} захищені checkout
 */
function parseWorktreeState(text) {
  const branches = new Map()
  const commits = new Map()
  let path = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    if (line.startsWith('HEAD ')) commits.set(line.slice('HEAD '.length), path)
    if (line.startsWith('branch ')) branches.set(line.slice('branch '.length), path)
    if (line.length === 0) path = ''
  }
  return { branches, commits }
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
    const worktree = worktrees.get(item.ref) ?? worktreeCommits.get(item.oid) ?? existing?.worktree ?? null
    const isRemote = item.ref.startsWith('refs/remotes/origin/')
    const aliases = [...new Set([...(existing?.aliases ?? []), item.ref])].toSorted()
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
 * @returns {{base:string,branches:Array<object>,stashes:Array<object>,warnings:string[]}} inventory
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
  const refs = dedupeRefs(
    refLines.map(line => {
      const [ref, oid, date] = line.split('\0')
      return { ref, oid, date }
    }),
    worktreeState.branches,
    worktreeState.commits,
    policy.protectedBranches
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

  const stashRows = git(['stash', 'list', '--format=%gd%x00%H%x00%gs'], cwd, spawnFn).stdout.split('\n').filter(Boolean)
  const stashes = stashRows.map(line => {
    const [ref, oid, subject] = line.split('\0')
    const changedFiles = git(['stash', 'show', '--name-status', ref], cwd, spawnFn).stdout.split('\n').filter(Boolean)
    return {
      source: `${SOURCE_STASH_PREFIX}${ref}`,
      ref,
      oid,
      subject,
      state: 'review',
      changedFiles
    }
  })

  return { base: baseRef, baseBranch: policy.baseBranch, branches, stashes, warnings }
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
    'Для кожного source поверни action: pr, keep або drop.',
    'pr — лише завершена корисна поведінка; groups розділяють незалежні PR.',
    'keep — бракує доказів або робота активна/незавершена. drop — явно артефакт/застаріле.',
    'Для branch group commits — непорожній subset commit oid із facts. Для stash commits не потрібні.',
    'Відповідь — лише JSON без markdown:',
    '{"decisions":[{"source":"branch:refs/remotes/origin/x","action":"pr","rationale":"...","groups":[{"title":"fix: ...","commits":["oid"]}]}]}',
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
 * Обирає вільну rescue-гілку.
 * @param {string} title PR title
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string} branch
 */
function chooseBranch(title, cwd, spawnFn) {
  const base = `codex/reconcile-${branchSlug(title)}`
  let candidate = base
  let suffix = 2
  while (
    git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], cwd, spawnFn, {
      allowFailure: true
    }).status === 0 ||
    git(['ls-remote', '--exit-code', '--heads', 'origin', candidate], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
  ) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

/**
 * Створює керований worktree та детерміновано пересаджує його branch на
 * policy base ref без зміни вихідного checkout.
 * @param {string} title PR title
 * @param {string} source source id
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{branch:string,cwd:string}} worktree
 */
function createReconcileWorktree(title, source, cwd, spawnFn) {
  const baseRef = policyBaseRef(cwd)
  const branch = chooseBranch(title, cwd, spawnFn)
  let worktreeCwd
  try {
    run('npx', ['@7n/mt', 'worktree', 'create', branch, `git-reconcile: ${source}`], cwd, spawnFn)
    const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain'], cwd, spawnFn).stdout)
    worktreeCwd = worktrees.get(`refs/heads/${branch}`)
    if (!worktreeCwd) throw new Error(`@7n/mt не зареєстрував worktree для ${branch}`)
    git(['switch', '--detach', baseRef], worktreeCwd, spawnFn)
    git(['branch', '-f', branch, baseRef], worktreeCwd, spawnFn)
    git(['switch', branch], worktreeCwd, spawnFn)
    return { branch, cwd: worktreeCwd }
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
 * @param {{branch:string,cwd:string}} worktree створений worktree
 * @param {string} rootCwd корінь репо
 * @param {typeof spawnSync} spawnFn інжект
 */
function removeReconcileWorktree(worktree, rootCwd, spawnFn) {
  const removed = run('npx', ['@7n/mt', 'worktree', 'remove', worktree.branch], rootCwd, spawnFn, {
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
 * @returns {{ok:boolean,error?:string}} gate
 */
function validateScopedProjectGates(cwd, spawnFn, onProgress = noop) {
  for (const path of changedSourceDirectories(cwd, spawnFn)) {
    onProgress(`doc-files (${path})`)
    const docs = run('npx', ['@7n/rules', 'lint', 'doc-files', '--path', path], cwd, spawnFn, {
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
    const lint = run('npx', ['@7n/rules', 'lint', '--path', path, '--no-fix'], cwd, spawnFn, {
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
 * @returns {{attempted:boolean,ok:boolean,error?:string}} результат
 */
export function remediateBehaviorState(cwd, spawnFn = spawnSync, validation = {}, onProgress = noop) {
  if (validation.remediation !== 'canonical-fixers') return { attempted: false, ok: false }

  for (const path of changedSourceDirectories(cwd, spawnFn)) {
    onProgress(`deterministic fix (${path})`)
    const fixed = run('npx', ['@7n/rules', 'lint', '--path', path], cwd, spawnFn, {
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
  const changelog = run('npx', ['@7n/rules', 'lint', 'changelog'], cwd, spawnFn, {
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
 */
function ensureWorktreeDependencies(cwd, spawnFn) {
  if (!existsSync(join(cwd, 'package.json')) || !existsSync(join(cwd, 'bun.lock'))) return
  if (existsSync(join(cwd, 'node_modules'))) return
  run('bun', ['install', '--frozen-lockfile'], cwd, spawnFn)
}

/**
 * Фіксує test baseline на чистій policy base гілці до перенесення source.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{tests:{status:number,stdout:string,stderr:string}|null}} baseline
 */
export function captureBehaviorBaseline(cwd, spawnFn = spawnSync) {
  ensureWorktreeDependencies(cwd, spawnFn)
  const packageJsonPath = join(cwd, 'package.json')
  if (!existsSync(packageJsonPath)) return { tests: null }
  const packageJson = parseJson(readFileSync(packageJsonPath, 'utf8'), {})
  const tests = packageJson?.scripts?.test ? run('bun', ['run', 'test'], cwd, spawnFn, { allowFailure: true }) : null
  return { tests }
}

/**
 * Повторно використовує test baseline однієї policy base гілки між PR-групами.
 * Залежності все одно встановлюються в кожному окремому worktree.
 * @param {string} cwd worktree
 * @param {Map<string,object>} cache кеш за OID бази
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{baseline:object,cached:boolean}} baseline і ознака cache hit
 */
export function captureCachedBehaviorBaseline(cwd, cache, spawnFn = spawnSync) {
  ensureWorktreeDependencies(cwd, spawnFn)
  const baseOid = git(['rev-parse', policyBaseRef(cwd)], cwd, spawnFn).stdout.trim()
  if (cache.has(baseOid)) return { baseline: cache.get(baseOid), cached: true }
  const baseline = captureBehaviorBaseline(cwd, spawnFn)
  cache.set(baseOid, baseline)
  return { baseline, cached: false }
}

/**
 * Додає до Git-state validation test script із репозиторію і changelog gate.
 * Саме ці докази вирішують, чи приймати min-результат або ескалювати на max.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @param {{tests:{status:number,stdout:string,stderr:string}|null}|null} [baseline] стан policy base гілки
 * @param {(stage:string)=>void} [onProgress] stage callback
 * @returns {{ok:boolean,error?:string}} validation
 */
export function validateBehaviorState(cwd, spawnFn = spawnSync, baseline = null, onProgress = noop) {
  const gitState = validateGitState(cwd, spawnFn)
  if (!gitState.ok) return gitState
  const projectGates = validateScopedProjectGates(cwd, spawnFn, onProgress)
  if (!projectGates.ok) return projectGates
  const postGateGitState = validateGitState(cwd, spawnFn)
  if (!postGateGitState.ok) return postGateGitState

  const packageJsonPath = join(cwd, 'package.json')
  if (existsSync(packageJsonPath)) {
    const packageJson = parseJson(readFileSync(packageJsonPath, 'utf8'), {})
    if (packageJson?.scripts?.test) {
      onProgress('project tests')
      const tests = run('bun', ['run', 'test'], cwd, spawnFn, { allowFailure: true })
      if (!acceptsTestOutcome(baseline?.tests ?? null, tests)) {
        return { ok: false, error: `bun run test: ${tests.stderr || tests.stdout}` }
      }
    }
  }

  onProgress('changelog')
  const changelog = run('npx', ['@7n/rules', 'lint', 'changelog', '--no-fix'], cwd, spawnFn, { allowFailure: true })
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
 * @returns {{ok:boolean,error?:string}} gate
 */
export function validateFinalProjectGates(cwd, spawnFn = spawnSync) {
  for (const path of changedNonCodeDirectories(cwd, spawnFn)) {
    const lint = run('npx', ['@7n/rules', 'lint', '--path', path, '--no-fix'], cwd, spawnFn, {
      allowFailure: true
    })
    if (lint.status !== 0) return { ok: false, error: `domain lint (${path}): ${lint.stderr || lint.stdout}` }
  }
  const changelog = run('npx', ['@7n/rules', 'lint', 'changelog', '--no-fix'], cwd, spawnFn, {
    allowFailure: true
  })
  if (changelog.status !== 0) return { ok: false, error: `changelog gate: ${changelog.stderr || changelog.stdout}` }
  return { ok: true }
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
      validateBehaviorState(worktreeCwd, spawnFn, baseline, step => onProgress(`behavior validation: ${step}`)),
    remediate: validation =>
      remediateBehaviorState(worktreeCwd, spawnFn, validation, step => onProgress(`behavior validation: ${step}`))
  })
  if (!outcome.ok) throw new Error(`LLM behavioral verification: ${outcome.error}`)
  return outcome.text.slice(0, PROMPT_TEXT_LIMIT)
}

/**
 * Створює один готовий PR. При будь-якому провалі worktree лишається для
 * ручного відновлення; прибирається тільки після успішного gh pr create.
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
      const captured = captureCachedBehaviorBaseline(worktree.cwd, baselineCache, spawnFn)
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
    if (!hasChangesFromBase(worktree.cwd, spawnFn)) {
      onProgress('remove no-op worktree')
      removeReconcileWorktree(worktree, rootCwd, spawnFn)
      return { status: 'patch-equivalent', branch: worktree.branch }
    }
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
        : 'Додатковий behavioral LLM не потрібен: code paths не змінено.'
    onProgress('Git validation')
    const unresolved = unresolvedFiles(worktree.cwd, spawnFn)
    if (unresolved.length > 0) throw new Error(`Нерозв'язані конфлікти: ${unresolved.join(', ')}`)
    git(['diff', '--check'], worktree.cwd, spawnFn)
    git(['add', '-A'], worktree.cwd, spawnFn)
    const staged =
      git(['diff', '--cached', '--quiet'], worktree.cwd, spawnFn, {
        allowFailure: true
      }).status !== 0
    if (staged) git(['commit', '-m', group.title], worktree.cwd, spawnFn)
    if (!hasChangesFromBase(worktree.cwd, spawnFn)) {
      onProgress('remove no-op worktree')
      removeReconcileWorktree(worktree, rootCwd, spawnFn)
      return { status: 'patch-equivalent', branch: worktree.branch }
    }
    onProgress('delta lint')
    const finalGates = validateFinalProjectGates(worktree.cwd, spawnFn)
    if (!finalGates.ok) throw new Error(finalGates.error)
    const baseRef = policyBaseRef(worktree.cwd)
    const baseBranch = readGitPolicy(worktree.cwd).baseBranch
    git(['diff', '--check', `${baseRef}...HEAD`], worktree.cwd, spawnFn)
    onProgress('push')
    git(['push', '-u', 'origin', worktree.branch], worktree.cwd, spawnFn)

    onProgress('create PR')
    const body = [
      `Джерело: \`${source}\`.`,
      '',
      group.rationale ?? candidate.rationale ?? `Корисну поведінку перенесено на актуальний ${baseBranch}.`,
      '',
      'Перевірки:',
      `- \`git diff --check ${baseRef}...HEAD\``,
      '- scoped code lint/tests та domain lint для non-code paths',
      '- `npx @7n/rules lint changelog --no-fix`',
      verification ? `- LLM behavioral verification: ${verification.slice(0, 1000)}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    createdPr = run(
      'gh',
      ['pr', 'create', '--base', baseBranch, '--head', worktree.branch, '--title', group.title, '--body', body],
      worktree.cwd,
      spawnFn
    ).stdout.trim()
    onProgress('remove worktree')
    removeReconcileWorktree(worktree, rootCwd, spawnFn)
    return { status: 'pr-created', url: createdPr, branch: worktree.branch }
  } catch (error) {
    const setup = /** @type {{branch?:string,worktree?:string}} */ (error)
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
        git(['push', 'origin', '--delete', branchName(ref)], rootCwd, spawnFn)
      } else if (ref.startsWith('refs/heads/')) {
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
 * Формує deterministic report.
 * @param {{inventory:object,results:Array<object>}} args дані
 * @returns {string} markdown
 */
export function formatReport({ inventory, results }) {
  const lines = ['## git-reconcile: підсумок']
  for (const branch of inventory.branches) {
    if (branch.state === 'review') continue
    let suffix = ''
    if (branch.pr?.url) suffix = ` — ${branch.pr.url}`
    else if (branch.worktree) suffix = ` — ${branch.worktree}`
    const cleanupOid = branch.oid ? `; oid=${branch.oid}` : ''
    const removedRefs = formatRemovedRefs(branch.cleanup)
    const cleanup = branch.cleanup ? `; cleanup=${branch.cleanup.status}${cleanupOid}${removedRefs}` : ''
    lines.push(`- \`${branch.source ?? branch.name}\`: ${branch.state}${cleanup}${suffix}`)
  }
  for (const result of results) {
    const details = [
      result.url,
      result.error,
      result.rationale,
      result.worktree && `worktree=${result.worktree}`
    ].filter(Boolean)
    const suffix = details.length > 0 ? ` — ${details.join('; ')}` : ''
    const cleanupOid = result.oid ? `; oid=${result.oid}` : ''
    const removedRefs = formatRemovedRefs(result.cleanup)
    const cleanup = result.cleanup ? `; cleanup=${result.cleanup.status}${cleanupOid}${removedRefs}` : ''
    lines.push(`- \`${result.source}\`: ${result.status}${cleanup}${suffix}`)
  }
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
 * Прибирає Git-доведені merged/patch-equivalent branches.
 * @param {object} args cleanup context
 */
function cleanupInactiveBranches(args) {
  const { inventory, cleanup, rootCwd, spawnFn, progress, cleanupState } = args
  for (const branch of inventory.branches) {
    const inactive = ['merged', 'patch-equivalent'].includes(branch.state)
    if (inactive && !branch.worktree && !branch.pr) {
      cleanupState.index += 1
      const key = `cleanup-${cleanupState.index}`
      progress.step(key, branch.source)
      try {
        branch.cleanup = cleanup(branch, rootCwd, spawnFn)
      } finally {
        progress.done(key)
      }
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
  return inactive + reviewed
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
  const now = deps.now ?? (() => performance.now())
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const heartbeatMs = deps.heartbeatMs ?? PROGRESS_HEARTBEAT_MS
  const prConcurrency = normalizePrConcurrency(deps.prConcurrency ?? env.N_GIT_RECONCILE_CONCURRENCY)
  const baselineCache = new Map()

  const inventoryStartedAt = now()
  log('⏳ 1/4 inventory')
  const inventory = inventoryFn(rootCwd, { spawnFn })
  if (deps.ensureLocalWorktreeExclude !== false) {
    const ensureExclude = deps.ensureLocalWorktreeExclude ?? ensureLocalWorktreeExclude
    if (ensureExclude(rootCwd, spawnFn)) log('🛡️ Додано `.worktrees/` до локального `.git/info/exclude`')
  }
  const candidates = [...inventory.branches, ...inventory.stashes].filter(item => item.state === 'review')
  log(
    `✅ 1/4 inventory · ${elapsedLabel(inventoryStartedAt, now)} · ${inventory.branches.length} branches · ${inventory.stashes.length} stash`
  )

  const triageTotal = Math.ceil(candidates.length / REVIEW_BATCH_SIZE)
  const triageProgress = createPhaseProgress({
    total: triageTotal,
    unitLabel: 'triage-пакетів',
    phase: '2/4 triage',
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
  log(`✅ 2/4 triage · ${elapsedLabel(triageStartedAt, now)} · ${triageTotal} batches`)

  const prTotal = decisions.reduce((total, decision) => {
    return total + (decision.action === 'pr' && Array.isArray(decision.groups) ? decision.groups.length : 0)
  }, 0)
  const prProgress = createPhaseProgress({
    total: prTotal,
    unitLabel: 'PR-груп',
    phase: '3/4 PR',
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
  log(`✅ 3/4 PR · ${elapsedLabel(prStartedAt, now)} · ${prTotal} groups`)

  const { bySource, results } = materialized
  const cleanupCount = countCleanupSources(inventory, bySource, results)
  const cleanupProgress = createPhaseProgress({
    total: cleanupCount,
    unitLabel: 'джерел',
    phase: '4/4 cleanup',
    log,
    now,
    heartbeatMs,
    setIntervalFn,
    clearIntervalFn
  })
  const cleanupStartedAt = now()
  const cleanupState = { index: 0 }
  try {
    cleanupInactiveBranches({
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
  log(`✅ 4/4 cleanup · ${elapsedLabel(cleanupStartedAt, now)} · ${cleanupCount} sources`)

  const report = formatReport({ inventory, results })
  log(report)
  const ok = results.every(result => result.status !== 'failed' && result.incomplete !== true)
  return { ok, report, inventory, results }
}
