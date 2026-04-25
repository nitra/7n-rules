/**
 * Перевіряє GitHub Actions за правилом ga.mdc.
 *
 * Workflows лише з розширенням `.yml`, наявність clean/lint workflow, конфіг zizmor з ref-pin,
 * відсутність MegaLinter, коректний скрипт `lint-ga` у `package.json`, виклик у `lint-ga.yml`,
 * наявність composite `.github/actions/setup-bun-deps/action.yml` (його записує npx `\@nitra/cursor`),
 * `\.vscode/settings.json` — `editor.defaultFormatter` **oxc** для `[github-actions-workflow]`,
 * перед `uses: ./…/setup-bun-deps` у workflow — `actions/checkout` (runner інакше не бачить локальний action).
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

  for (const f of ['clean-ga-workflows.yml', 'clean-merged-branch.yml', 'lint-ga.yml', 'git-ai.yml']) {
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

  await checkZizmor(pass, fail)
  await checkLintGaScript(pass, fail)
  await checkLintGaWorkflow(wfDir, pass, fail)
  await checkGitAiWorkflow(wfDir, pass, fail)

  return reporter.getExitCode()
}
