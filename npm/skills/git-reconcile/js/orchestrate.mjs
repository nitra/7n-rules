/** @see ./docs/orchestrate.md */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE_REF = 'origin/main'
const REVIEW_BATCH_SIZE = 10
const PROMPT_TEXT_LIMIT = 12_000
const SOURCE_BRANCH_PREFIX = 'branch:'
const SOURCE_STASH_PREFIX = 'stash:'

/**
 * Виконує команду без shell-інтерполяції.
 * @param {string} command виконуваний файл
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {typeof spawnSync} spawnFn інжект для тестів
 * @param {{ allowFailure?: boolean, input?: string }} [options] режим помилки та stdin
 * @returns {{ status: number, stdout: string, stderr: string }} результат
 */
function run(command, args, cwd, spawnFn, options = {}) {
  const result = spawnFn(command, args, {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, GIT_EDITOR: 'true' },
    maxBuffer: 16 * 1024 * 1024
  })
  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
  if (!options.allowFailure && normalized.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} → exit ${normalized.status}: ${normalized.stderr || normalized.stdout}`
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
 * Парсить `git worktree list --porcelain` у branch→path.
 * @param {string} text porcelain
 * @returns {Map<string, string>} повний ref гілки → checkout
 */
export function parseWorktrees(text) {
  const out = new Map()
  let path = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    if (line.startsWith('branch ')) out.set(line.slice('branch '.length), path)
    if (line.length === 0) path = ''
  }
  return out
}

/**
 * Нормалізує branch ref у назву для зіставлення з GitHub PR.
 * @param {string} ref повний ref
 * @returns {string} коротке ім'я
 */
function branchName(ref) {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '')
}

/**
 * Дедуплікує local/remote refs одного commit: remote має пріоритет, але
 * worktree-protection локального ref переноситься у запис.
 * @param {Array<{ref:string, oid:string, date:string}>} refs сирі refs
 * @param {Map<string,string>} worktrees branch→path
 * @returns {Array<{ref:string, oid:string, date:string, worktree:string|null}>} refs
 */
export function dedupeRefs(refs, worktrees) {
  const byOid = new Map()
  for (const item of refs) {
    if (item.ref === 'refs/remotes/origin/HEAD' || branchName(item.ref) === 'main') continue
    const existing = byOid.get(item.oid)
    const worktree = worktrees.get(item.ref) ?? existing?.worktree ?? null
    const isRemote = item.ref.startsWith('refs/remotes/origin/')
    if (!existing || isRemote) {
      byOid.set(item.oid, { ...item, worktree })
    } else if (worktree) {
      existing.worktree = worktree
    }
  }
  return [...byOid.values()].toSorted((a, b) => a.ref.localeCompare(b.ref))
}

/**
 * Збирає відкриті PR; недоступний gh не блокує git-inventory.
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {Map<string,{number:number,url:string}>} head branch → PR
 */
function openPullRequests(cwd, spawnFn) {
  const result = run(
    'gh',
    ['pr', 'list', '--state', 'open', '--limit', '500', '--json', 'headRefName,number,url'],
    cwd,
    spawnFn,
    { allowFailure: true }
  )
  if (result.status !== 0) return new Map()
  const rows = /** @type {Array<{headRefName:string,number:number,url:string}>} */ (parseJson(result.stdout, []))
  return new Map(rows.map(row => [row.headRefName, { number: row.number, url: row.url }]))
}

/**
 * Збирає compact commit metadata лише для patch-унікальних non-merge комітів.
 * @param {string[]} oids commit ids
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {Array<{oid:string,subject:string}>} коміти
 */
function commitMetadata(oids, cwd, spawnFn) {
  return oids.map(oid => {
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
    const content = line.match(/^CONFLICT \(.+?\): Merge conflict in (.+)$/)
    const rename = line.match(/^CONFLICT \(rename\/delete\): .+? renamed to (.+?) in .+?, but deleted/)
    const modifyDelete = line.match(/^CONFLICT \(modify\/delete\): (.+?) deleted in /)
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
  git(['fetch', '--prune', 'origin'], cwd, spawnFn)
  git(['rev-parse', '--verify', BASE_REF], cwd, spawnFn)

  const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain'], cwd, spawnFn).stdout)
  const refLines = git(
    [
      'for-each-ref',
      '--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)',
      'refs/heads',
      'refs/remotes/origin'
    ],
    cwd,
    spawnFn
  ).stdout
    .split('\n')
    .filter(Boolean)
  const refs = dedupeRefs(
    refLines.map(line => {
      const [ref, oid, date] = line.split('\0')
      return { ref, oid, date }
    }),
    worktrees
  )
  const prs = openPullRequests(cwd, spawnFn)
  const warnings = []
  if (prs.size === 0) warnings.push('GitHub PR inventory порожній або gh недоступний')

  const branches = refs.map(item => {
    const name = branchName(item.ref)
    const merged = git(['merge-base', '--is-ancestor', item.ref, BASE_REF], cwd, spawnFn, {
      allowFailure: true
    }).status === 0
    const novelOids = merged
      ? []
      : git(
          ['rev-list', '--right-only', '--cherry-pick', '--no-merges', `${BASE_REF}...${item.ref}`],
          cwd,
          spawnFn
        ).stdout
          .split('\n')
          .filter(Boolean)
          .toReversed()
    const counts = git(['rev-list', '--left-right', '--count', `${BASE_REF}...${item.ref}`], cwd, spawnFn)
      .stdout.trim()
      .split(/\s+/)
      .map(Number)
    const pr = prs.get(name) ?? null
    const state = merged
      ? 'merged'
      : novelOids.length === 0
        ? 'patch-equivalent'
        : pr
          ? 'open-pr'
          : item.worktree
            ? 'protected'
            : 'review'
    const changedFiles =
      state === 'review'
        ? git(['diff', '--name-status', `${BASE_REF}...${item.ref}`], cwd, spawnFn).stdout
            .split('\n')
            .filter(Boolean)
            .slice(0, 200)
        : []
    const mergeTree =
      state === 'review'
        ? git(['merge-tree', BASE_REF, item.ref], cwd, spawnFn, { allowFailure: true }).stdout
        : ''
    return {
      source: `${SOURCE_BRANCH_PREFIX}${item.ref}`,
      ref: item.ref,
      name,
      oid: item.oid,
      date: item.date,
      state,
      worktree: item.worktree,
      pr,
      behind: counts[0] ?? 0,
      ahead: counts[1] ?? 0,
      commits: commitMetadata(novelOids, cwd, spawnFn),
      changedFiles,
      conflicts: conflictFiles(mergeTree)
    }
  })

  const stashRows = git(['stash', 'list', '--format=%gd%x00%gs'], cwd, spawnFn).stdout
    .split('\n')
    .filter(Boolean)
  const stashes = stashRows.map(line => {
    const [ref, subject] = line.split('\0')
    const changedFiles = git(['stash', 'show', '--name-status', ref], cwd, spawnFn).stdout
      .split('\n')
      .filter(Boolean)
    return {
      source: `${SOURCE_STASH_PREFIX}${ref}`,
      ref,
      subject,
      state: 'review',
      changedFiles
    }
  })

  return { base: BASE_REF, branches, stashes, warnings }
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
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
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
 * @returns {Promise<{ok:boolean,text:string,error:string|null}>} результат
 */
export async function callRunner(runner, prompt, cwd, deps = {}) {
  if (runner === 'pi') {
    let runAgentSkill = deps.runAgentSkill
    if (!runAgentSkill) {
      const module = await import('@7n/llm-lib/agent-skill')
      runAgentSkill = module.runAgentSkill
    }
    let text = ''
    const result = await runAgentSkill(prompt, {
      skillId: 'git-reconcile',
      tier: 'max',
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
  try {
    const text = await runAcpAgent(runner, prompt, cwd, { tier: 'max' })
    return { ok: true, text, error: null }
  } catch (error) {
    return { ok: false, text: '', error: error instanceof Error ? error.message : String(error) }
  }
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
 * origin/main без зміни вихідного checkout.
 * @param {string} title PR title
 * @param {string} source source id
 * @param {string} cwd корінь
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {{branch:string,cwd:string}} worktree
 */
function createReconcileWorktree(title, source, cwd, spawnFn) {
  const branch = chooseBranch(title, cwd, spawnFn)
  run('npx', ['@7n/mt', 'worktree', 'create', branch, `git-reconcile: ${source}`], cwd, spawnFn)
  const worktreeCwd = join(cwd, '.worktrees', branch.replaceAll('/', '-'))
  git(['switch', '--detach', BASE_REF], worktreeCwd, spawnFn)
  git(['branch', '-f', branch, BASE_REF], worktreeCwd, spawnFn)
  git(['switch', branch], worktreeCwd, spawnFn)
  return { branch, cwd: worktreeCwd }
}

/**
 * Перевіряє, чи лишились unmerged paths.
 * @param {string} cwd worktree
 * @param {typeof spawnSync} spawnFn інжект
 * @returns {string[]} шляхи
 */
function unresolvedFiles(cwd, spawnFn) {
  return git(['diff', '--name-only', '--diff-filter=U'], cwd, spawnFn).stdout
    .split('\n')
    .filter(Boolean)
}

/**
 * Просить LLM розв'язати лише вже матеріалізований конфлікт.
 * @param {object} args контекст
 * @returns {Promise<void>}
 */
async function resolveConflict({ runner, source, worktreeCwd, deps, spawnFn }) {
  const unresolved = unresolvedFiles(worktreeCwd, spawnFn)
  const prompt = [
    `У worktree ${worktreeCwd} JS уже застосував ${source} до свіжого origin/main.`,
    `Розв'яжи лише змістові конфлікти: ${unresolved.join(', ')}.`,
    'Порівняй current main та намір перенесеної зміни; не використовуй ours/theirs всліпу.',
    'Збережи актуальну поведінку main, перенеси лише відсутню корисну частину.',
    'За потреби онови regression test. Не commit, не push, не створюй PR і не видаляй refs.',
    'Наприкінці прибери conflict markers і коротко переліч перевірки.'
  ].join('\n\n')
  const outcome = await callRunner(runner, prompt, worktreeCwd, deps)
  if (!outcome.ok) throw new Error(`LLM conflict resolution: ${outcome.error}`)
  const remaining = unresolvedFiles(worktreeCwd, spawnFn)
  if (remaining.length > 0) throw new Error(`Нерозв'язані конфлікти: ${remaining.join(', ')}`)
  git(['add', '-A'], worktreeCwd, spawnFn)
}

/**
 * Застосовує один branch group або stash у worktree.
 * @param {object} args контекст
 * @returns {Promise<void>}
 */
async function applySource({ source, commits, runner, rootCwd, worktreeCwd, deps, spawnFn }) {
  if (source.startsWith(SOURCE_BRANCH_PREFIX)) {
    for (const oid of commits) {
      const result = git(['cherry-pick', oid], worktreeCwd, spawnFn, { allowFailure: true })
      if (result.status === 0) continue
      if (unresolvedFiles(worktreeCwd, spawnFn).length === 0) {
        throw new Error(`cherry-pick ${oid}: ${result.stderr || result.stdout}`)
      }
      await resolveConflict({ runner, source: oid, worktreeCwd, deps, spawnFn })
      if (
        git(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'], worktreeCwd, spawnFn, {
          allowFailure: true
        }).status === 0
      ) {
        git(['cherry-pick', '--continue'], worktreeCwd, spawnFn)
      }
    }
    return
  }

  const stashRef = source.slice(SOURCE_STASH_PREFIX.length)
  const patch = git(['stash', 'show', '-p', '--binary', stashRef], rootCwd, spawnFn).stdout
  const applied = git(['apply', '--3way', '-'], worktreeCwd, spawnFn, {
    allowFailure: true,
    input: patch
  })
  if (applied.status !== 0) {
    if (unresolvedFiles(worktreeCwd, spawnFn).length === 0) {
      throw new Error(`git apply ${stashRef}: ${applied.stderr || applied.stdout}`)
    }
    await resolveConflict({ runner, source: stashRef, worktreeCwd, deps, spawnFn })
  }
}

/**
 * Делегує LLM лише behavioral verification/fix у вже зібраному worktree.
 * @param {object} args контекст
 * @returns {Promise<string>} текст відповіді
 */
async function finalizeBehavior({ runner, source, rationale, worktreeCwd, deps }) {
  const prompt = [
    `JS переніс ${source} на свіжий origin/main у ${worktreeCwd}.`,
    `Очікувана користь: ${rationale}`,
    'Перевір реальний diff і call sites. Доведи лише перенесену поведінку до готовності:',
    '- додай/онови regression test, якщо це bug fix;',
    '- виконай найвужчі релевантні тести;',
    '- виконай repository-required docs/change checks;',
    '- не роби unrelated refactor або formatting churn.',
    'Не commit, не push, не створюй PR і не видаляй refs. Якщо поведінку неможливо безпечно підтвердити — нічого не маскуй, поверни чіткий blocker.'
  ].join('\n\n')
  const outcome = await callRunner(runner, prompt, worktreeCwd, deps)
  if (!outcome.ok) throw new Error(`LLM behavioral verification: ${outcome.error}`)
  return outcome.text.slice(0, PROMPT_TEXT_LIMIT)
}

/**
 * Створює один готовий PR. При будь-якому провалі worktree лишається для
 * ручного відновлення; прибирається тільки після успішного gh pr create.
 * @param {object} args параметри
 * @returns {Promise<{status:string,url?:string,branch?:string,error?:string,worktree?:string}>} результат
 */
async function createPullRequest({ candidate, group, runner, rootCwd, deps, spawnFn, log }) {
  const source = candidate.source
  const validOids = new Set(candidate.commits?.map(commit => commit.oid) ?? [])
  const commits = source.startsWith(SOURCE_BRANCH_PREFIX)
    ? (group.commits ?? []).filter(oid => validOids.has(oid))
    : []
  if (source.startsWith(SOURCE_BRANCH_PREFIX) && commits.length === 0) {
    return { status: 'kept', error: 'LLM не вибрала жодного валідного commit oid' }
  }

  const worktree = createReconcileWorktree(group.title, source, rootCwd, spawnFn)
  log(`🌿 ${source} → ${worktree.branch}`)
  try {
    await applySource({
      source,
      commits,
      runner,
      rootCwd,
      worktreeCwd: worktree.cwd,
      deps,
      spawnFn
    })
    const verification = await finalizeBehavior({
      runner,
      source,
      rationale: group.rationale ?? candidate.rationale ?? '',
      worktreeCwd: worktree.cwd,
      deps
    })
    const unresolved = unresolvedFiles(worktree.cwd, spawnFn)
    if (unresolved.length > 0) throw new Error(`Нерозв'язані конфлікти: ${unresolved.join(', ')}`)
    git(['diff', '--check'], worktree.cwd, spawnFn)
    git(['add', '-A'], worktree.cwd, spawnFn)
    const staged = git(['diff', '--cached', '--quiet'], worktree.cwd, spawnFn, {
      allowFailure: true
    }).status !== 0
    if (staged) git(['commit', '-m', group.title], worktree.cwd, spawnFn)
    const ahead = Number(git(['rev-list', '--count', `${BASE_REF}..HEAD`], worktree.cwd, spawnFn).stdout.trim())
    if (!ahead) throw new Error('Після reconciliation немає змін відносно origin/main')

    const changelog = run(
      'npx',
      ['@7n/rules', 'lint', 'changelog', '--no-fix'],
      worktree.cwd,
      spawnFn,
      { allowFailure: true }
    )
    if (changelog.status !== 0) {
      throw new Error(`changelog gate: ${changelog.stderr || changelog.stdout}`)
    }
    git(['diff', '--check', `${BASE_REF}...HEAD`], worktree.cwd, spawnFn)
    git(['push', '-u', 'origin', worktree.branch], worktree.cwd, spawnFn)

    const body = [
      `Джерело: \`${source}\`.`,
      '',
      group.rationale ?? candidate.rationale ?? 'Корисну поведінку перенесено на актуальний main.',
      '',
      'Перевірки:',
      '- `git diff --check origin/main...HEAD`',
      '- `npx @7n/rules lint changelog --no-fix`',
      verification ? `- LLM behavioral verification: ${verification.slice(0, 1000)}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const pr = run(
      'gh',
      ['pr', 'create', '--base', 'main', '--head', worktree.branch, '--title', group.title, '--body', body],
      worktree.cwd,
      spawnFn
    ).stdout.trim()
    run('npx', ['@7n/mt', 'worktree', 'remove', worktree.branch], rootCwd, spawnFn, {
      allowFailure: true
    })
    return { status: 'pr-created', url: pr, branch: worktree.branch }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      branch: worktree.branch,
      worktree: worktree.cwd
    }
  }
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
    const suffix = branch.pr?.url ? ` — ${branch.pr.url}` : branch.worktree ? ` — ${branch.worktree}` : ''
    lines.push(`- \`${branch.name}\`: ${branch.state}${suffix}`)
  }
  for (const result of results) {
    const suffix = result.url
      ? ` — ${result.url}`
      : result.error
        ? ` — ${result.error}`
        : result.rationale
          ? ` — ${result.rationale}`
          : ''
    lines.push(`- \`${result.source}\`: ${result.status}${suffix}`)
  }
  for (const warning of inventory.warnings) lines.push(`- ⚠️ ${warning}`)
  return lines.join('\n')
}

/**
 * JS-оркестратор: inventory → bounded LLM triage → deterministic PR pipeline.
 * Нічого не видаляє; `drop` є лише рекомендацією у звіті.
 * @param {{cwd?:string,runner?:'pi'|'cursor'|'codex',task?:string,log?:(line:string)=>void,deps?:object}} [options] опції
 * @returns {Promise<{ok:boolean,report:string,inventory:object,results:Array<object>}>} результат
 */
export async function runGitReconcileOrchestrator(options = {}) {
  const rootCwd = options.cwd ?? process.cwd()
  const runner = options.runner ?? 'pi'
  const task = options.task ?? ''
  const log = options.log ?? (line => console.log(line))
  const deps = options.deps ?? {}
  const spawnFn = deps.spawnFn ?? spawnSync
  const call = deps.callRunner ?? callRunner
  const inventoryFn = deps.inventoryRepository ?? inventoryRepository
  const createPr = deps.createPullRequest ?? createPullRequest
  const inventory = inventoryFn(rootCwd, { spawnFn })
  const candidates = [...inventory.branches, ...inventory.stashes].filter(item => item.state === 'review')
  const decisions = []

  for (let offset = 0; offset < candidates.length; offset += REVIEW_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + REVIEW_BATCH_SIZE)
    log(`🧠 semantic triage ${offset + 1}-${offset + batch.length}/${candidates.length}`)
    const outcome = await call(runner, buildTriagePrompt(batch, task), rootCwd, deps)
    if (!outcome.ok) {
      for (const candidate of batch) {
        decisions.push({
          source: candidate.source,
          action: 'keep',
          rationale: `LLM triage failed: ${outcome.error}`,
          groups: []
        })
      }
      continue
    }
    const envelope = parseDecisionEnvelope(outcome.text)
    const returned = Array.isArray(envelope?.decisions) ? envelope.decisions : []
    const bySource = new Map(returned.map(decision => [decision.source, decision]))
    for (const candidate of batch) {
      const decision = bySource.get(candidate.source)
      decisions.push(
        decision && ['pr', 'keep', 'drop'].includes(decision.action)
          ? decision
          : { source: candidate.source, action: 'keep', rationale: 'Невалідна LLM-відповідь', groups: [] }
      )
    }
  }

  const bySource = new Map(candidates.map(candidate => [candidate.source, candidate]))
  const results = []
  for (const decision of decisions) {
    const candidate = bySource.get(decision.source)
    if (!candidate) continue
    if (decision.action !== 'pr') {
      results.push({
        source: decision.source,
        status: decision.action === 'drop' ? 'drop-recommended' : 'kept',
        rationale: decision.rationale ?? ''
      })
      continue
    }
    const groups = Array.isArray(decision.groups) ? decision.groups : []
    if (groups.length === 0) {
      results.push({
        source: decision.source,
        status: 'kept',
        error: 'LLM позначила pr без groups'
      })
      continue
    }
    for (const group of groups) {
      results.push(
        await createPr({
          candidate: { ...candidate, rationale: decision.rationale },
          group,
          runner,
          rootCwd,
          deps,
          spawnFn,
          log
        }).then(result => ({ source: decision.source, ...result }))
      )
    }
  }

  const report = formatReport({ inventory, results })
  log(report)
  const ok = results.every(result => result.status !== 'failed')
  return { ok, report, inventory, results }
}
