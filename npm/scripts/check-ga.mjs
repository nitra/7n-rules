/**
 * Перевіряє GitHub Actions за правилом ga.mdc.
 *
 * Workflows лише з розширенням `.yml`, наявність clean/lint workflow, конфіг zizmor з ref-pin,
 * відсутність MegaLinter, коректний скрипт `lint-ga` у `package.json`, виклик у `lint-ga.yml`,
 * наявність composite `.github/actions/setup-bun-deps/action.yml` (його записує npx `\@nitra/cursor`),
 * `\.vscode/settings.json` — `editor.defaultFormatter` **oxc** для `[github-actions-workflow]`,
 * перед `uses: ./…/setup-bun-deps` у workflow — `actions/checkout` (runner інакше не бачить локальний action).
 *
 * Також перевіряє, що ключові workflow (`clean-ga-workflows.yml`, `clean-merged-branch.yml`, `lint-ga.yml`, `git-ai.yml`)
 * мають структуру й значення, узгоджені з `npm/mdc/ga.mdc`. Для цих файлів перевірка виконується структурно
 * (після YAML parse), щоб не залежати від форматування/відступів.
 *
 * Заборонено дублювати кроки встановлення Bun та кешування безпосередньо у workflow файлах
 * (oven-sh/setup-bun, actions/cache, bun install). Перевірки `uses`/`run` виконуються після **YAML parse**
 * (`yaml`), щоб не спрацьовувати на випадкові збіги в коментарях або поза кроками.
 *
 * У `run:` заборонено shell-продовження рядків через `\\` перед переносом; довгі команди — через folded block `>-`.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  anyRunStepIncludes,
  eventPathsIncludeExact,
  findForbiddenUsesOrRunPatterns,
  findRunStepsWithShellLineContinuationBackslash,
  hasAnyStepUsesContaining,
  hasCheckoutBeforeLocalSetupBunDeps,
  flattenWorkflowSteps,
  getStepRun,
  getStepUses,
  parseWorkflowYaml
} from './utils/gha-workflow.mjs'

/** Шаблони наявності MegaLinter у вмісті workflow */
const MEGALINTER_USE_PATTERNS = [/oxsecurity\/megalinter-action/i, /megalinter\/megalinter/i]

/** Типові конфіги MegaLinter у корені репо */
const MEGALINTER_CONFIG_NAMES = ['.mega-linter.yml', '.megalinter.yaml', '.mega-linter.yaml']

/** Локальні composite setup-bun-deps (ga.mdc). */
const SETUP_BUN_PATTERNS = ['./.github/actions/setup-bun-deps', './npm/github-actions/setup-bun-deps']

/** Заборонені підрядки лише в кроках uses/run. */
const FORBIDDEN_BUN_PATTERNS = [
  { pattern: 'oven-sh/setup-bun', msg: 'використовуй .github/actions/setup-bun-deps замість oven-sh/setup-bun' },
  { pattern: 'actions/cache', msg: 'використовуй .github/actions/setup-bun-deps замість actions/cache' },
  { pattern: 'bun install', msg: 'використовуй .github/actions/setup-bun-deps замість bun install' }
]

/** Обовʼязкові workflow-файли (ga.mdc). */
const REQUIRED_WORKFLOWS = ['clean-ga-workflows.yml', 'clean-merged-branch.yml', 'lint-ga.yml', 'git-ai.yml']

/**
 * Безпечний доступ до вкладеного поля (лише для обʼєктів).
 * @param {unknown} obj значення-кандидат на обʼєкт
 * @param {string} key ключ
 * @returns {unknown} значення поля або undefined
 */
function getObjKey(obj, key) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  return /** @type {Record<string, unknown>} */ (obj)[key]
}

/**
 * Очікує, що значення є рядком рівно `expected`.
 * @param {unknown} v значення
 * @param {string} expected очікуваний рядок
 * @returns {boolean} true, якщо збігається
 */
function isExactString(v, expected) {
  return typeof v === 'string' && v === expected
}

/**
 * Перевіряє структуру workflow `clean-ga-workflows.yml` (ga.mdc).
 * @param {Record<string, unknown> | null} root parsed YAML
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
function validateCleanGaWorkflows(root, passFn, failFn) {
  if (!root) {
    failFn('clean-ga-workflows.yml: YAML не вдалося розібрати (ga.mdc)')
    return
  }

  if (!isExactString(root.name, 'Clean action for removing completed workflow runs')) {
    failFn('clean-ga-workflows.yml: name має бути "Clean action for removing completed workflow runs" (ga.mdc)')
  } else {
    passFn('clean-ga-workflows.yml: name OK')
  }

  const on = root.on
  const schedule = getObjKey(on, 'schedule')
  const wfDispatch = getObjKey(on, 'workflow_dispatch')

  const hasCron =
    Array.isArray(schedule) &&
    schedule.some(v => v && typeof v === 'object' && /** @type {Record<string, unknown>} */ (v).cron === '0 1 16 * *')

  if (!hasCron) {
    failFn("clean-ga-workflows.yml: on.schedule має містити cron: '0 1 16 * *' (ga.mdc)")
  } else {
    passFn('clean-ga-workflows.yml: cron OK')
  }

  if (!wfDispatch || typeof wfDispatch !== 'object') {
    failFn('clean-ga-workflows.yml: має бути workflow_dispatch: {} (ga.mdc)')
  } else {
    passFn('clean-ga-workflows.yml: workflow_dispatch OK')
  }

  const jobs = getObjKey(root, 'jobs')
  const job = getObjKey(jobs, 'cleanup_old_workflows')
  if (!job) {
    failFn('clean-ga-workflows.yml: jobs.cleanup_old_workflows відсутній (ga.mdc)')
    return
  }

  if (!isExactString(getObjKey(job, 'runs-on'), 'ubuntu-latest')) {
    failFn('clean-ga-workflows.yml: runs-on має бути ubuntu-latest (ga.mdc)')
  }

  const perm = getObjKey(job, 'permissions')
  if (!(getObjKey(perm, 'actions') === 'write' && getObjKey(perm, 'contents') === 'read')) {
    failFn('clean-ga-workflows.yml: permissions мають бути actions: write, contents: read (ga.mdc)')
  }

  const steps = getObjKey(job, 'steps')
  const step0 = Array.isArray(steps) ? steps[0] : null
  if (!step0 || typeof step0 !== 'object') {
    failFn('clean-ga-workflows.yml: steps має містити крок з dmvict/clean-workflow-runs@v1 (ga.mdc)')
    return
  }

  if (!isExactString(getObjKey(step0, 'name'), 'Delete workflow runs')) {
    failFn('clean-ga-workflows.yml: перший крок має мати name: Delete workflow runs (ga.mdc)')
  }
  if (!isExactString(getObjKey(step0, 'uses'), 'dmvict/clean-workflow-runs@v1')) {
    failFn('clean-ga-workflows.yml: перший крок має uses: dmvict/clean-workflow-runs@v1 (ga.mdc)')
  }
  const withObj = getObjKey(step0, 'with')
  if (
    !(getObjKey(withObj, 'token') === '${{ github.token }}' &&
      getObjKey(withObj, 'save_period') === 31 &&
      getObjKey(withObj, 'save_min_runs_number') === 0)
  ) {
    failFn('clean-ga-workflows.yml: with має містити token/save_period/save_min_runs_number як у ga.mdc')
  } else {
    passFn('clean-ga-workflows.yml: jobs/steps OK')
  }
}

/**
 * Перевіряє структуру workflow `clean-merged-branch.yml` (ga.mdc).
 * @param {Record<string, unknown> | null} root parsed YAML
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
function validateCleanMergedBranch(root, passFn, failFn) {
  if (!root) {
    failFn('clean-merged-branch.yml: YAML не вдалося розібрати (ga.mdc)')
    return
  }

  if (!isExactString(root.name, 'Clean abandoned branches')) {
    failFn('clean-merged-branch.yml: name має бути "Clean abandoned branches" (ga.mdc)')
  } else {
    passFn('clean-merged-branch.yml: name OK')
  }

  const on = root.on
  const schedule = getObjKey(on, 'schedule')
  const wfDispatch = getObjKey(on, 'workflow_dispatch')
  const hasCron =
    Array.isArray(schedule) &&
    schedule.some(v => v && typeof v === 'object' && /** @type {Record<string, unknown>} */ (v).cron === '0 1 15 * *')

  if (!hasCron) {
    failFn("clean-merged-branch.yml: on.schedule має містити cron: '0 1 15 * *' (ga.mdc)")
  } else {
    passFn('clean-merged-branch.yml: cron OK')
  }

  if (!wfDispatch || typeof wfDispatch !== 'object') {
    failFn('clean-merged-branch.yml: має бути workflow_dispatch: {} (ga.mdc)')
  }

  const jobs = getObjKey(root, 'jobs')
  const job = getObjKey(jobs, 'cleanup_old_branches')
  if (!job) {
    failFn('clean-merged-branch.yml: jobs.cleanup_old_branches відсутній (ga.mdc)')
    return
  }

  const perm = getObjKey(job, 'permissions')
  if (!(getObjKey(perm, 'contents') === 'write')) {
    failFn('clean-merged-branch.yml: permissions мають бути contents: write (ga.mdc)')
  }

  const steps = getObjKey(job, 'steps')
  if (!Array.isArray(steps) || steps.length < 2) {
    failFn('clean-merged-branch.yml: steps має містити 2 кроки як у ga.mdc')
    return
  }

  const step0 = steps[0]
  if (!step0 || typeof step0 !== 'object') {
    failFn('clean-merged-branch.yml: перший крок невалідний (ga.mdc)')
    return
  }

  if (!isExactString(getObjKey(step0, 'id'), 'delete_stuff')) {
    failFn('clean-merged-branch.yml: перший крок має id: delete_stuff (ga.mdc)')
  }
  if (!isExactString(getObjKey(step0, 'uses'), 'phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3')) {
    failFn('clean-merged-branch.yml: перший крок має uses як у ga.mdc')
  }
  const withObj = getObjKey(step0, 'with')
  if (getObjKey(withObj, 'github_token') !== '${{ github.token }}') {
    failFn('clean-merged-branch.yml: with.github_token має бути ${{ github.token }} (ga.mdc)')
  }
  if (getObjKey(withObj, 'last_commit_age_days') !== 90) {
    failFn('clean-merged-branch.yml: with.last_commit_age_days має бути 90 (ga.mdc)')
  }

  const ignoreBranches = String(getObjKey(withObj, 'ignore_branches') ?? '')
  if (!(ignoreBranches.includes('main') && ignoreBranches.includes('dev'))) {
    failFn('clean-merged-branch.yml: with.ignore_branches має містити main,dev (ga.mdc)')
  }

  if (getObjKey(withObj, 'dry_run') !== 'no') {
    failFn('clean-merged-branch.yml: with.dry_run має бути no (ga.mdc)')
  }

  const step1 = steps[1]
  if (!step1 || typeof step1 !== 'object') {
    failFn('clean-merged-branch.yml: другий крок невалідний (ga.mdc)')
    return
  }

  if (!isExactString(getObjKey(step1, 'name'), 'Get output')) {
    failFn('clean-merged-branch.yml: другий крок має name: Get output (ga.mdc)')
  }
  const env = getObjKey(step1, 'env')
  if (getObjKey(env, 'DELETED_BRANCHES') !== '${{ steps.delete_stuff.outputs.deleted_branches }}') {
    failFn('clean-merged-branch.yml: env.DELETED_BRANCHES має бути як у ga.mdc')
  }
  if (!String(getObjKey(step1, 'run') ?? '').includes('echo "Deleted branches: ${DELETED_BRANCHES}"')) {
    failFn('clean-merged-branch.yml: run має echo Deleted branches як у ga.mdc')
  } else {
    passFn('clean-merged-branch.yml: jobs/steps OK')
  }
}

/**
 * Перевіряє структуру workflow `lint-ga.yml` (ga.mdc).
 * @param {Record<string, unknown> | null} root parsed YAML
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
function validateLintGaWorkflowStructure(root, passFn, failFn) {
  if (!root) {
    failFn('lint-ga.yml: YAML не вдалося розібрати (ga.mdc)')
    return
  }

  if (!isExactString(root.name, 'Lint GA')) {
    failFn('lint-ga.yml: name має бути "Lint GA" (ga.mdc)')
  }

  const on = root.on
  const push = getObjKey(on, 'push')
  const pr = getObjKey(on, 'pull_request')
  const pushBranches = getObjKey(push, 'branches')
  const pushPaths = getObjKey(push, 'paths')
  const prBranches = getObjKey(pr, 'branches')

  if (!Array.isArray(pushBranches) || !(pushBranches.includes('dev') && pushBranches.includes('main'))) {
    failFn('lint-ga.yml: on.push.branches має містити dev і main (ga.mdc)')
  }
  if (!Array.isArray(prBranches) || !(prBranches.includes('dev') && prBranches.includes('main'))) {
    failFn('lint-ga.yml: on.pull_request.branches має містити dev і main (ga.mdc)')
  }
  if (!Array.isArray(pushPaths) || !(pushPaths.includes('.github/actions/**') && pushPaths.includes('.github/workflows/**'))) {
    failFn('lint-ga.yml: on.push.paths має містити .github/actions/** і .github/workflows/** (ga.mdc)')
  }

  const conc = getObjKey(root, 'concurrency')
  if (!(getObjKey(conc, 'cancel-in-progress') === true)) {
    failFn('lint-ga.yml: concurrency.cancel-in-progress має бути true (ga.mdc)')
  }

  const jobs = getObjKey(root, 'jobs')
  const job = getObjKey(jobs, 'lint-ga')
  if (!job) {
    failFn('lint-ga.yml: jobs.lint-ga відсутній (ga.mdc)')
    return
  }

  if (!isExactString(getObjKey(job, 'runs-on'), 'ubuntu-latest')) {
    failFn('lint-ga.yml: runs-on має бути ubuntu-latest (ga.mdc)')
  }
  const perm = getObjKey(job, 'permissions')
  if (!(getObjKey(perm, 'contents') === 'read')) {
    failFn('lint-ga.yml: permissions мають бути contents: read (ga.mdc)')
  }

  const steps = getObjKey(job, 'steps')
  if (!Array.isArray(steps) || steps.length === 0) {
    failFn('lint-ga.yml: jobs.lint-ga.steps відсутні (ga.mdc)')
    return
  }

  const flat = flattenWorkflowSteps(root)
  const usesList = flat.map(s => getStepUses(s.step))
  const runBlob = flat.map(s => getStepRun(s.step)).join('\n')

  if (!usesList.includes('actions/checkout@v6')) {
    failFn('lint-ga.yml: має бути uses: actions/checkout@v6 (ga.mdc)')
  }
  if (!usesList.includes('./.github/actions/setup-bun-deps')) {
    failFn('lint-ga.yml: має бути uses: ./.github/actions/setup-bun-deps (ga.mdc)')
  }
  if (!usesList.includes('astral-sh/setup-uv@v8.0.0')) {
    failFn('lint-ga.yml: має бути uses: astral-sh/setup-uv@v8.0.0 (ga.mdc)')
  }
  if (!runBlob.includes('bun run lint-ga')) {
    failFn('lint-ga.yml: має бути крок run: bun run lint-ga (ga.mdc)')
  } else {
    passFn('lint-ga.yml: структура jobs/steps OK')
  }
}

/**
 * Перевіряє структуру workflow `git-ai.yml` (ga.mdc).
 * @param {Record<string, unknown> | null} root parsed YAML
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
function validateGitAiWorkflowStructure(root, passFn, failFn) {
  if (!root) {
    failFn('git-ai.yml: YAML не вдалося розібрати (ga.mdc)')
    return
  }

  if (!isExactString(root.name, 'Git AI')) {
    failFn('git-ai.yml: name має бути "Git AI" (ga.mdc)')
  }

  const on = root.on
  const pr = getObjKey(on, 'pull_request')
  const types = getObjKey(pr, 'types')
  if (!Array.isArray(types) || !types.includes('closed')) {
    failFn('git-ai.yml: on.pull_request.types має містити closed (ga.mdc)')
  }

  const jobs = getObjKey(root, 'jobs')
  const job = getObjKey(jobs, 'git-ai')
  if (!job) {
    failFn('git-ai.yml: jobs.git-ai відсутній (ga.mdc)')
    return
  }

  if (!String(getObjKey(job, 'if') ?? '').includes('github.event.pull_request.merged == true')) {
    failFn('git-ai.yml: job має містити if: github.event.pull_request.merged == true (ga.mdc)')
  }

  const perm = getObjKey(job, 'permissions')
  if (!(getObjKey(perm, 'contents') === 'write')) {
    failFn('git-ai.yml: permissions мають бути contents: write (ga.mdc)')
  }

  const flat = flattenWorkflowSteps(root)
  const runBlob = flat.map(s => getStepRun(s.step)).join('\n')
  if (!runBlob.includes('curl -fsSL https://usegitai.com/install.sh | bash')) {
    failFn('git-ai.yml: має встановлювати git-ai через curl | bash (ga.mdc)')
  }
  if (!runBlob.includes('git-ai ci github run')) {
    failFn('git-ai.yml: має виконувати git-ai ci github run (ga.mdc)')
  } else {
    passFn('git-ai.yml: структура jobs/steps OK')
  }
}

/**
 * Якщо workflow викликає локальний setup-bun-deps, раніше у файлі має бути `actions/checkout@v…` (ga.mdc).
 * Fallback: сирий текст, якщо YAML не вдається розібрати.
 * @param {string} relPath шлях для повідомлень
 * @param {string} content вміст YAML
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyCheckoutBeforeLocalSetupBunDeps(relPath, content, failFn, passFn) {
  const root = parseWorkflowYaml(content)
  if (root) {
    if (!hasAnyStepUsesContaining(root, SETUP_BUN_PATTERNS)) {
      return
    }
    if (!hasCheckoutBeforeLocalSetupBunDeps(root, SETUP_BUN_PATTERNS)) {
      failFn(
        `${relPath}: перед локальним setup-bun-deps потрібен крок actions/checkout@v6 — інакше runner не знайде action.yml (ga.mdc)`
      )
      return
    }
    passFn(`${relPath}: перед setup-bun-deps є checkout`)
    return
  }
  let idxSetup = -1
  for (const p of SETUP_BUN_PATTERNS) {
    const i = content.indexOf(p)
    if (i !== -1 && (idxSetup === -1 || i < idxSetup)) {
      idxSetup = i
    }
  }
  if (idxSetup === -1) {
    return
  }
  const idxCheckout = content.indexOf('actions/checkout@v')
  if (idxCheckout === -1 || idxCheckout > idxSetup) {
    failFn(
      `${relPath}: перед локальним setup-bun-deps потрібен крок actions/checkout@v6 — інакше runner не знайде action.yml (ga.mdc)`
    )
    return
  }
  passFn(`${relPath}: перед setup-bun-deps є checkout`)
}

/**
 * Перевіряє заборонені кроки Bun/cache/install у `uses` та `run`.
 * @param {string} relPath шлях для повідомлень
 * @param {string} content вміст YAML
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyNoDirectBunOrCache(relPath, content, failFn, passFn) {
  const root = parseWorkflowYaml(content)
  if (root) {
    const hits = findForbiddenUsesOrRunPatterns(root, FORBIDDEN_BUN_PATTERNS)
    if (hits.length === 0) {
      passFn(`${relPath}: не містить заборонених кроків setup-bun/cache/install`)
    } else {
      for (const h of hits) {
        failFn(`${relPath}: ${h.msg} (ga.mdc)`)
      }
    }
    return
  }
  let foundForbidden = false
  for (const { pattern, msg } of FORBIDDEN_BUN_PATTERNS) {
    if (content.includes(pattern)) {
      failFn(`${relPath}: ${msg} (ga.mdc)`)
      foundForbidden = true
    }
  }
  if (!foundForbidden) {
    passFn(`${relPath}: не містить заборонених кроків setup-bun/cache/install`)
  }
}

/**
 * У кроках `run` заборонено shell-продовження через `\\` перед переносом; замість `run: |` з `\\` використовуй `run: >-`.
 * @param {string} relPath шлях для повідомлень
 * @param {string} content вміст YAML
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyNoRunShellLineContinuationBackslash(relPath, content, failFn, passFn) {
  const root = parseWorkflowYaml(content)
  if (!root) {
    return
  }
  const hits = findRunStepsWithShellLineContinuationBackslash(root)
  if (hits.length === 0) {
    passFn(String.raw`${relPath}: run без shell-продовження через \ (ga.mdc)`)
    return
  }
  for (const h of hits) {
    failFn(
      String.raw`${relPath}: job ${h.jobId}, крок ${h.stepIndex + 1}: у run заборонено продовження рядків через зворотний сліш; довгі команди оформи як folded block (run: >-) без \ на кінцях рядків (ga.mdc)`
    )
  }
}

/**
 * Перевіряє apply-workflow на наявність paths trigger.
 * @param {string} wfDir директорія workflows
 * @param {string[]} files список файлів у директорії
 * @param {string} filename параметр filename
 * @param {string} expectedPath параметр expectedPath
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkApplyWorkflow(wfDir, files, filename, expectedPath, passFn, failFn) {
  if (!files.includes(filename)) return
  const content = await readFile(`${wfDir}/${filename}`, 'utf8')
  const root = parseWorkflowYaml(content)
  const ok = root ? eventPathsIncludeExact(root, 'push', expectedPath) : content.includes(expectedPath)
  if (ok) {
    passFn(`${filename} має правильний paths trigger`)
  } else {
    failFn(`${filename} не містить paths: ${expectedPath}`)
  }
}

/**
 * Перевіряє відсутність MegaLinter у workflows та конфіг-файлах.
 * @param {string} wfDir директорія workflows
 * @param {string[]} ymlWorkflows параметр ymlWorkflows
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkMegalinter(wfDir, ymlWorkflows, passFn, failFn) {
  let found = false
  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    if (MEGALINTER_USE_PATTERNS.some(re => re.test(content))) {
      found = true
      failFn(`MegaLinter у workflow ${wfDir}/${f} — видали інтеграцію (ga.mdc: MegaLinter)`)
    }
  }
  for (const name of MEGALINTER_CONFIG_NAMES) {
    if (existsSync(name)) {
      found = true
      failFn(`Файл ${name} — видали конфіг MegaLinter (ga.mdc: MegaLinter)`)
    }
  }
  if (!found) passFn('Залишків MegaLinter не виявлено')
}

/**
 * Перевіряє zizmor конфіг.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkZizmor(passFn, failFn) {
  const zizmorPath = '.github/zizmor.yml'
  if (!existsSync(zizmorPath)) {
    failFn(`Відсутній ${zizmorPath} — потрібен для zizmor (ga.mdc)`)
    return
  }
  const z = await readFile(zizmorPath, 'utf8')
  passFn(`${zizmorPath} існує`)
  if (z.includes('ref-pin')) {
    passFn(`${zizmorPath} містить політику ref-pin (zizmor)`)
  } else {
    failFn(`${zizmorPath}: додай policies ref-pin для unpinned-uses (ga.mdc)`)
  }
}

/**
 * Перевіряє `.vscode/settings.json`: oxfmt/oxc як default formatter для GitHub Actions workflow (мова
 * `github-actions-workflow` з розширення github.vscode-github-actions), узгоджено з oxc для yaml/workflow.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkVscodeSettingsForGa(passFn, failFn) {
  const rel = '.vscode/settings.json'
  if (!existsSync(rel)) {
    failFn(`${rel} не існує — додай [github-actions-workflow].editor.defaultFormatter = oxc.oxc-vscode (ga.mdc)`)
    return
  }
  let settings
  try {
    settings = JSON.parse(await readFile(rel, 'utf8'))
  } catch {
    failFn(`${rel}: невалідний JSON (ga.mdc)`)
    return
  }
  if (!settings || typeof settings !== 'object') {
    failFn(`${rel}: очікується об’єкт налаштувань (ga.mdc)`)
    return
  }
  const block = /** @type {Record<string, unknown>} */ (settings)['[github-actions-workflow]']
  if (!block || typeof block !== 'object' || block === null || Array.isArray(block)) {
    failFn(`${rel}: додай "[github-actions-workflow]": { "editor.defaultFormatter": "oxc.oxc-vscode" } (ga.mdc)`)
    return
  }
  const df = String(/** @type {Record<string, unknown>} */ (block)['editor.defaultFormatter'] ?? '')
  if (df !== 'oxc.oxc-vscode') {
    failFn(
      `${rel}: [github-actions-workflow].editor.defaultFormatter має бути "oxc.oxc-vscode" (зараз: ${df || '∅'}) (ga.mdc)`
    )
    return
  }
  passFn(`${rel}: [github-actions-workflow] → oxc.oxc-vscode`)
}

/**
 * Перевіряє скрипт lint-ga в package.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkLintGaScript(passFn, failFn) {
  if (!existsSync('package.json')) {
    failFn('package.json не існує — потрібен lint-ga у scripts')
    return
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const lg = pkg.scripts?.['lint-ga']
  if (typeof lg !== 'string') {
    failFn('package.json: додай скрипт "lint-ga" (ga.mdc)')
    return
  }
  passFn('package.json містить lint-ga')
  if (lg.includes('node-actionlint')) {
    passFn('lint-ga викликає node-actionlint')
  } else {
    failFn('lint-ga має містити bunx node-actionlint (ga.mdc)')
  }
  if (lg.includes('zizmor') && lg.includes('--offline')) {
    passFn('lint-ga викликає zizmor з --offline')
  } else {
    failFn('lint-ga має містити zizmor і --offline (ga.mdc)')
  }
}

/**
 * Перевіряє lint-ga.yml workflow.
 * @param {string} wfDir директорія workflows
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkLintGaWorkflow(wfDir, passFn, failFn) {
  const lintGaWf = join(wfDir, 'lint-ga.yml')
  if (!existsSync(lintGaWf)) return
  const lgContent = await readFile(lintGaWf, 'utf8')
  const root = parseWorkflowYaml(lgContent)
  const hasBunRun = root ? anyRunStepIncludes(root, 'bun run lint-ga') : lgContent.includes('bun run lint-ga')
  const hasSetupUv = root
    ? hasAnyStepUsesContaining(root, ['astral-sh/setup-uv']) || lgContent.includes('astral-sh/setup-uv')
    : lgContent.includes('astral-sh/setup-uv')
  if (hasBunRun) {
    passFn('lint-ga.yml викликає bun run lint-ga')
  } else {
    failFn('lint-ga.yml: крок має містити bun run lint-ga')
  }
  if (hasSetupUv) {
    passFn('lint-ga.yml містить astral-sh/setup-uv')
  } else {
    failFn('lint-ga.yml: додай astral-sh/setup-uv для uvx zizmor (ga.mdc)')
  }
}

/**
 * Перевіряє розширення workflow-файлів і наявність обов'язкових workflow.
 * @param {string} wfDir шлях до директорії workflows
 * @param {string[]} files список файлів у wfDir
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
function checkGaWorkflowFiles(wfDir, files, pass, fail) {
  const yamlFiles = files.filter(f => f.endsWith('.yaml'))
  if (yamlFiles.length > 0) {
    for (const f of yamlFiles) {
      fail(`Workflow з розширенням .yaml: ${wfDir}/${f} — перейменуй на .yml`)
    }
  } else {
    pass('Всі workflows мають розширення .yml')
  }

  const notYmlFiles = files.filter(f => !f.endsWith('.yml'))
  if (notYmlFiles.length > 0) {
    for (const f of notYmlFiles) {
      fail(`Workflow має бути з розширенням .yml: ${wfDir}/${f} (ga.mdc)`)
    }
  }

  for (const f of REQUIRED_WORKFLOWS) {
    if (files.includes(f)) {
      pass(`${f} існує`)
    } else {
      fail(`Відсутній ${wfDir}/${f}`)
    }
  }
}

/**
 * Перевіряє, чи on.pull_request.types у parsed YAML містить 'closed'.
 * @param {Record<string, unknown>} root розібраний YAML workflow
 * @returns {boolean} true, якщо тригер pull_request має тип closed
 */
function hasPullRequestClosedTrigger(root) {
  const on = root.on
  if (!on || typeof on !== 'object') return false
  const pr = /** @type {Record<string, unknown>} */ (on)['pull_request']
  if (!pr || typeof pr !== 'object') return false
  const types = /** @type {Record<string, unknown>} */ (pr).types
  return Array.isArray(types) && types.includes('closed')
}

/**
 * Перевіряє, чи будь-який job у parsed YAML має if-умову з 'merged'.
 * @param {Record<string, unknown>} root розібраний YAML workflow
 * @returns {boolean} true, якщо хоча б один job містить умову merged
 */
function hasJobMergedCondition(root) {
  const { jobs } = root
  if (!jobs || typeof jobs !== 'object') return false
  return Object.values(jobs).some(job => {
    if (!job || typeof job !== 'object') return false
    const ifCond = String(/** @type {Record<string, unknown>} */ (job).if ?? '')
    return ifCond.includes('merged')
  })
}

/**
 * Перевіряє parsed YAML git-ai.yml: тригер closed та умова merged.
 * @param {Record<string, unknown>} root розібраний YAML workflow
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function validateGitAiParsedYaml(root, passFn, failFn) {
  if (hasPullRequestClosedTrigger(root)) {
    passFn('git-ai.yml: on.pull_request.types містить closed')
  } else {
    failFn('git-ai.yml: on.pull_request.types має містити closed (ga.mdc)')
  }

  if (hasJobMergedCondition(root)) {
    passFn('git-ai.yml: job має умову merged')
  } else {
    failFn('git-ai.yml: job має містити if: github.event.pull_request.merged == true (ga.mdc)')
  }
}

/**
 * Перевіряє git-ai.yml: тригер pull_request з types: [closed], умова merged у job, виклик git-ai.
 * @param {string} wfDir директорія workflows
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkGitAiWorkflow(wfDir, passFn, failFn) {
  const gitAiWf = join(wfDir, 'git-ai.yml')
  if (!existsSync(gitAiWf)) return
  const content = await readFile(gitAiWf, 'utf8')
  const root = parseWorkflowYaml(content)

  if (root) {
    validateGitAiParsedYaml(root, passFn, failFn)
  }

  const hasGitAiRun = root ? anyRunStepIncludes(root, 'git-ai ci github run') : content.includes('git-ai ci github run')
  if (hasGitAiRun) {
    passFn('git-ai.yml: крок виконує git-ai ci github run')
  } else {
    failFn('git-ai.yml: крок має містити git-ai ci github run (ga.mdc)')
  }
}

/**
 * Перевіряє, що “канонічні” workflows відповідають ga.mdc (структура і значення).
 * @param {string} wfDir директорія workflows
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
async function checkCanonicalWorkflowsMatchRule(wfDir, passFn, failFn) {
  const paths = {
    cleanGa: join(wfDir, 'clean-ga-workflows.yml'),
    cleanMerged: join(wfDir, 'clean-merged-branch.yml'),
    lintGa: join(wfDir, 'lint-ga.yml'),
    gitAi: join(wfDir, 'git-ai.yml')
  }

  if (existsSync(paths.cleanGa)) {
    const c = await readFile(paths.cleanGa, 'utf8')
    validateCleanGaWorkflows(parseWorkflowYaml(c), passFn, failFn)
  }
  if (existsSync(paths.cleanMerged)) {
    const c = await readFile(paths.cleanMerged, 'utf8')
    validateCleanMergedBranch(parseWorkflowYaml(c), passFn, failFn)
  }
  if (existsSync(paths.lintGa)) {
    const c = await readFile(paths.lintGa, 'utf8')
    validateLintGaWorkflowStructure(parseWorkflowYaml(c), passFn, failFn)
  }
  if (existsSync(paths.gitAi)) {
    const c = await readFile(paths.gitAi, 'utf8')
    validateGitAiWorkflowStructure(parseWorkflowYaml(c), passFn, failFn)
  }
}

/**
 * Перевіряє відповідність проєкту правилам ga.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const wfDir = '.github/workflows'

  if (!existsSync(wfDir)) {
    fail(`Директорія ${wfDir} не існує`)
    return reporter.getExitCode()
  }

  const setupBunDepsAction = '.github/actions/setup-bun-deps/action.yml'
  if (existsSync(setupBunDepsAction)) {
    pass(`${setupBunDepsAction} існує`)
  } else {
    fail(
      `Відсутній ${setupBunDepsAction} — запустіть npx @nitra/cursor або скопіюйте з пакету (ga.mdc: composite setup-bun-deps)`
    )
  }

  const files = await readdir(wfDir)
  checkGaWorkflowFiles(wfDir, files, pass, fail)

  await checkApplyWorkflow(wfDir, files, 'apply-k8s.yml', '**/k8s/**/*.yaml', pass, fail)
  await checkApplyWorkflow(wfDir, files, 'apply-nats-consumer.yml', '**/consumer.yaml', pass, fail)

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    if (ext.recommendations?.includes('github.vscode-github-actions')) {
      pass('extensions.json містить github.vscode-github-actions')
    } else {
      fail('extensions.json не містить github.vscode-github-actions')
    }
  } else {
    fail('.vscode/extensions.json не існує')
  }

  await checkVscodeSettingsForGa(pass, fail)

  const ymlWorkflows = files.filter(f => f.endsWith('.yml'))
  await checkMegalinter(wfDir, ymlWorkflows, pass, fail)

  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    verifyCheckoutBeforeLocalSetupBunDeps(`${wfDir}/${f}`, content, fail, pass)
    verifyNoDirectBunOrCache(`${wfDir}/${f}`, content, fail, pass)
    verifyNoRunShellLineContinuationBackslash(`${wfDir}/${f}`, content, fail, pass)
  }

  await checkCanonicalWorkflowsMatchRule(wfDir, pass, fail)

  await checkZizmor(pass, fail)
  await checkLintGaScript(pass, fail)
  await checkLintGaWorkflow(wfDir, pass, fail)
  await checkGitAiWorkflow(wfDir, pass, fail)

  return reporter.getExitCode()
}
