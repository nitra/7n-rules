/** @see ./docs/workflows.md */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { eventPathsIncludeExact, parseWorkflowYaml } from '../../../scripts/lib/gha-workflow.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runConftestBatch } from '../../../scripts/lib/run-conftest-batch.mjs'
import { loadTemplate } from '../../../scripts/lib/template.mjs'
import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { runLintStep } from '../../../scripts/lib/run-lint-step.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GA_POLICY_DIR = join(HERE, '..')

/** Шаблони наявності MegaLinter у вмісті workflow */
const MEGALINTER_USE_PATTERNS = [/oxsecurity\/megalinter-action/i, /megalinter\/megalinter/i]

/** Типові конфіги MegaLinter у корені репо */
const MEGALINTER_CONFIG_NAMES = ['.mega-linter.yml', '.megalinter.yaml', '.mega-linter.yaml']

/** Обовʼязкові workflow-файли (ga.mdc). */
const REQUIRED_WORKFLOWS = ['clean-ga-workflows.yml', 'clean-merged-branch.yml', 'lint-ga.yml', 'git-ai.yml']

/** Патерн rego-violation про відсутній `persist-credentials`. */
const CHECKOUT_PERSIST_RE = /persist-credentials/u

/**
 * Structured fix-hint (#3) для rego-violation про `actions/checkout` без
 * `persist-credentials: false` — щоб T0 (`fix-workflows.mjs`) автофіксив детерміновано,
 * не парсячи message. Повертає `{ reason, file, data }` або undefined.
 * @param {string} file posix-relative шлях workflow-файла від cwd
 * @param {unknown} message текст rego-violation
 * @returns {{ reason: string, file: string, data: { kind: string } } | undefined} fix-hint або undefined
 */
function checkoutPersistHint(file, message) {
  return CHECKOUT_PERSIST_RE.test(String(message ?? ''))
    ? { reason: 'checkout-persist-credentials', file, data: { kind: 'checkout-persist-credentials' } }
    : undefined
}

/**
 * Повертає true, якщо glob у GitHub Actions `on.*.paths` матчитсья хоча б на один tracked файл у репозиторії.
 *
 * Використовує `git ls-files` з pathspec-магiєю `:(glob)`, щоб не реалізовувати glob engine вручну
 * і не сканувати файлову систему рекурсивно.
 * @param {string} globPattern glob з workflow (наприклад "files/**" або "image-migration-new/**")
 * @param {string} cwd робочий каталог для `git`
 * @returns {boolean} true, якщо є хоча б один збіг
 */
function gitHasAnyTrackedFileMatchingGlob(globPattern, cwd) {
  const p = String(globPattern ?? '').trim()
  if (!p) return false
  if (p.startsWith('!')) return true
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', `:(glob)${p}`], { encoding: 'utf8', cwd })
    return out.length > 0
  } catch {
    return false
  }
}

/**
 * Чи варто перевіряти glob з `on.*.paths` на наявність збігів у репозиторії.
 *
 * У багатьох workflow (особливо лінтерах) `paths` часто містить “широкі” шаблони по розширеннях
 * (наприклад `*.vue`, `*.php`), які можуть бути відсутні в конкретному репозиторії й це ок.
 * Запит цієї перевірки — ловити посилання на неіснуючі директорії/шляхи (типово `some-dir/**`).
 * @param {string} p glob з workflow
 * @returns {boolean} true, якщо треба валідувати наявність файлів
 */
function shouldValidateWorkflowPathsGlob(p) {
  // Негативні патерни — лише виключають, їх існування не перевіряємо.
  if (p.startsWith('!')) return false

  // “Розширення-фільтри” (або brace-варіанти) пропускаємо: вони можуть бути заготовками.
  return !p.includes('*.')
}

/**
 * Перевіряє один glob з `on.<event>.paths` на наявність збігів у репо.
 * @param {string} relPath шлях workflow для повідомлень
 * @param {string} eventName назва події (push / pull_request)
 * @param {unknown} raw сирий елемент масиву paths
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 * @param {string} cwd робочий каталог для `git`
 */
function verifyOnePathsGlob(relPath, eventName, raw, passFn, failFn, cwd) {
  const p = String(raw ?? '').trim()
  if (!p) return
  if (!shouldValidateWorkflowPathsGlob(p)) {
    passFn(`${relPath}: on.${eventName}.paths glob пропущено для перевірки існування: ${JSON.stringify(p)}`)
    return
  }
  if (gitHasAnyTrackedFileMatchingGlob(p, cwd)) {
    passFn(`${relPath}: on.${eventName}.paths glob матчитсья: ${JSON.stringify(p)}`)
  } else {
    failFn(`${relPath}: on.${eventName}.paths glob не матчитсья ні на один файл: ${JSON.stringify(p)}`, {
      reason: 'unmatched-paths-glob',
      file: relPath,
      data: { kind: 'unmatched-paths-glob', event: eventName, glob: p }
    })
  }
}

/**
 * Валідує `on.push.paths` / `on.pull_request.paths`: кожен позитивний glob має мати збіги в репозиторії.
 * @param {string} relPath шлях workflow для повідомлень
 * @param {Record<string, unknown>} root parsed YAML workflow
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 * @param {string} cwd робочий каталог для `git`
 */
function verifyWorkflowEventPathsGlobsExist(relPath, root, passFn, failFn, cwd) {
  const on = getObjKey(root, 'on')
  if (!on || typeof on !== 'object') return

  /** @type {Array<[eventName: string, paths: unknown]>} */
  const candidates = [
    ['push', getObjKey(getObjKey(on, 'push'), 'paths')],
    ['pull_request', getObjKey(getObjKey(on, 'pull_request'), 'paths')]
  ]

  for (const [eventName, paths] of candidates) {
    if (!Array.isArray(paths)) continue
    for (const raw of paths) {
      verifyOnePathsGlob(relPath, eventName, raw, passFn, failFn, cwd)
    }
  }
}

const RUN_INLINE_NCURSOR_RE = /^\s*(?:-\s*)?run:\s*n-cursor\s/u
const BARE_LINE_NCURSOR_RE = /^\s+n-cursor\s/u
const WRAPPED_NCURSOR_RE = /\b(?:bunx|npx)\s+n-cursor/u

/**
 * Прапорить кроки, що інвокають **bare `n-cursor`** (не `bunx`/`npx n-cursor`): у CI-раннері
 * `n-cursor` не на PATH (`node_modules/.bin` не додається), тож `run: n-cursor …` падає з
 * exit 127. Канон — `bunx n-cursor …` (як у npm-publish.yml). Structured fix-hint для T0.
 * @param {string} relPath posix-relative шлях workflow
 * @param {string} content сирий вміст workflow
 * @param {(msg: string, opts?: object) => void} failFn реєстрація порушення
 */
function verifyNoBareNCursor(relPath, content, failFn) {
  for (const [i, line] of content.split('\n').entries()) {
    if (WRAPPED_NCURSOR_RE.test(line)) continue
    if (!RUN_INLINE_NCURSOR_RE.test(line) && !BARE_LINE_NCURSOR_RE.test(line)) continue
    failFn(
      `${relPath}: \`n-cursor …\` (рядок ${i + 1}) має бути \`bunx n-cursor …\` — n-cursor не на PATH у CI (ga.mdc)`,
      {
        reason: 'bare-n-cursor',
        file: relPath,
        data: { kind: 'bare-n-cursor' }
      }
    )
  }
}

/**
 * Безпечний доступ до вкладеного поля (лише для обʼєктів).
 * @param {unknown} obj значення-кандидат на обʼєкт
 * @param {string} key ключ
 * @returns {unknown} значення поля або undefined
 */
function getObjKey(obj, key) {
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    ? /** @type {Record<string, unknown>} */ (obj)[key]
    : undefined
}

/**
 * Перевіряє apply-workflow на наявність paths trigger.
 * @param {string} wfDir абсолютна директорія workflows
 * @param {string[]} files список файлів у директорії
 * @param {string} filename параметр filename
 * @param {string} expectedPath параметр expectedPath
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkApplyWorkflow(wfDir, files, filename, expectedPath, passFn, failFn) {
  if (!files.includes(filename)) return
  const content = await readFile(join(wfDir, filename), 'utf8')
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
 * @param {string} wfDir абсолютна директорія workflows
 * @param {string[]} ymlWorkflows параметр ymlWorkflows
 * @param {string} wfDirRel відносний шлях директорії workflows для повідомлень
 * @param {string} cwd корінь репозиторію
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkMegalinter(wfDir, ymlWorkflows, wfDirRel, cwd, passFn, failFn) {
  let found = false
  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    if (MEGALINTER_USE_PATTERNS.some(re => re.test(content))) {
      found = true
      failFn(`MegaLinter у workflow ${wfDirRel}/${f} — видали інтеграцію (ga.mdc: MegaLinter)`)
    }
  }
  for (const name of MEGALINTER_CONFIG_NAMES) {
    if (!existsSync(join(cwd, name))) {
      continue
    }

    found = true
    failFn(`Файл ${name} — видали конфіг MegaLinter (ga.mdc: MegaLinter)`)
  }
  if (!found) passFn('Залишків MegaLinter не виявлено')
}

/**
 * Перевіряє наявність локального `shellcheck` у PATH. `actionlint` (`bunx github-actionlint`)
 * запускає shell-перевірки в кроках `run:` workflow тільки коли `shellcheck` доступний; інакше
 * мовчки пропускає SC-правила, через що локальний `bun lint-ga` зелений, а CI на ubuntu-latest
 * (де shellcheck передвстановлений) падає. Тому відсутність бінарника локально — `fail`.
 *
 * Кросплатформно: `resolveCmd` використовує `which`/`where` і однаково знаходить `shellcheck`
 * та `shellcheck.exe` на Windows.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
export function checkShellcheckInstalled(passFn, failFn) {
  if (resolveCmd('shellcheck')) {
    passFn('shellcheck встановлений локально, actionlint виконуватиме SC-правила, як у CI')
    return
  }
  failFn(
    [
      'shellcheck не знайдено в PATH — actionlint без нього мовчки пропускає shell-перевірки в run: блоках,',
      'тому локальний `bun lint-ga` буде зелений, а CI на ubuntu-latest (де shellcheck передвстановлений) падатиме.',
      'Встанови: macOS — `brew install shellcheck`; Debian/Ubuntu — `sudo apt-get install -y shellcheck`;',
      'Arch — `sudo pacman -S shellcheck` (ga.mdc)'
    ].join(' ')
  )
}

/**
 * Перевіряє розширення workflow-файлів і наявність обов'язкових workflow.
 * @param {string} wfDirRel відносний шлях директорії workflows для повідомлень
 * @param {string[]} files список файлів у wfDir
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
function checkGaWorkflowFiles(wfDirRel, files, pass, fail) {
  const yamlFiles = files.filter(f => f.endsWith('.yaml'))
  if (yamlFiles.length > 0) {
    for (const f of yamlFiles) {
      fail(`Workflow з розширенням .yaml: ${wfDirRel}/${f} — перейменуй на .yml`)
    }
  } else {
    pass('Всі workflows мають розширення .yml')
  }

  const notYmlFiles = files.filter(f => !f.endsWith('.yml'))
  if (notYmlFiles.length > 0) {
    for (const f of notYmlFiles) {
      fail(`Workflow має бути з розширенням .yml: ${wfDirRel}/${f} (ga.mdc)`)
    }
  }

  for (const f of REQUIRED_WORKFLOWS) {
    if (files.includes(f)) {
      pass(`${f} існує`)
    } else {
      fail(`Відсутній ${wfDirRel}/${f}`)
    }
  }
}

/**
 * Per-workflow Rego-полісі: namespace ↔ конкретний workflow-файл. Кожен пакет
 * у `npm/policy/ga/<name>/` містить правила специфічні для ОДНОГО workflow,
 * тому conftest викликаємо з `--namespace` окремо на кожен файл (інакше правила
 * чужого workflow застосуються до неправильного файла).
 * @type {Array<{ workflow: string, namespace: string, policyDirRel: string }>}
 */
const GA_PER_WORKFLOW_REGO_TARGETS = [
  {
    workflow: '.github/workflows/clean-ga-workflows.yml',
    namespace: 'ga.clean_ga_workflows',
    policyDirRel: 'ga/clean_ga_workflows'
  },
  {
    workflow: '.github/workflows/clean-merged-branch.yml',
    namespace: 'ga.clean_merged_branch',
    policyDirRel: 'ga/clean_merged_branch'
  },
  {
    workflow: '.github/workflows/lint-ga.yml',
    namespace: 'ga.lint_ga',
    policyDirRel: 'ga/lint_ga'
  },
  {
    workflow: '.github/workflows/git-ai.yml',
    namespace: 'ga.git_ai',
    policyDirRel: 'ga/git_ai'
  }
]

/**
 * Plan B (rego-authoritative): на початку перевірки правила ga прогнати усі
 * Rego-полісі з `npm/policy/ga/`. Спочатку — per-workflow (4 окремі спавни,
 * бо кожен namespace застосовний лише до свого файла), потім один батч-спавн
 * `ga.workflow_common` на всі `.github/workflows/*.yml`. Hard-fail без
 * `conftest` у PATH — узгоджено з Plan B (див. `runConftestBatch`).
 * @param {string} wfDir абсолютний шлях до `.github/workflows`
 * @param {string[]} ymlWorkflows відносні (від `wfDir`) імена файлів `*.yml`
 * @param {string} cwd корінь репозиторію
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void}
 */
async function runAllGaRego(wfDir, ymlWorkflows, cwd, pass, fail) {
  for (const target of GA_PER_WORKFLOW_REGO_TARGETS) {
    const targetAbs = join(cwd, target.workflow)
    if (!existsSync(targetAbs)) continue
    const concernDir = join(GA_POLICY_DIR, target.policyDirRel.split('/', 2)[1])
    const tpl = await loadTemplate(concernDir)
    const templateData = tpl[basename(target.workflow)]
    const violations = runConftestBatch({
      policyDirRel: target.policyDirRel,
      namespace: target.namespace,
      files: [targetAbs],
      templateData
    })
    for (const v of violations)
      fail(`${target.workflow}: ${v.message}`, checkoutPersistHint(target.workflow, v.message))
    if (violations.length === 0) {
      pass(`${target.workflow}: відповідає ${target.namespace} (rego)`)
    }
  }

  if (ymlWorkflows.length === 0) return
  const wfFiles = ymlWorkflows.map(f => join(wfDir, f))
  const workflowCommonDir = join(GA_POLICY_DIR, 'workflow_common')
  const workflowCommonTpl = await loadTemplate(workflowCommonDir)
  const usesMinVersionsSnippet = workflowCommonTpl['uses-min-versions']?.snippet
  const violations = runConftestBatch({
    policyDirRel: 'ga/workflow_common',
    namespace: 'ga.workflow_common',
    files: wfFiles,
    templateData: usesMinVersionsSnippet ? { snippet: usesMinVersionsSnippet } : undefined
  })
  for (const v of violations) {
    fail(`${v.filename}: ${v.message}`, checkoutPersistHint(relative(cwd, v.filename), v.message))
  }
  if (violations.length === 0) {
    pass(`${wfFiles.length} workflow(s) відповідають ga.workflow_common (rego)`)
  }
}

/**
 * Перевіряє відповідність проєкту правилам ga.mdc.
 *
 * Plan B-патерн: пер-документна валідація workflow-структури делегована
 * Rego-полісі у `npm/policy/ga/`; виклик через `runAllGaRego` (батч-conftest)
 * — це перший крок `check()`. Далі — JS-частина (cross-file перевірки на
 * наявність файлів, `git ls-files`-залежні `on.push.paths` glob, vscode/zizmor
 * config, megalinter залишки тощо). `bun run lint-ga` додатково запускає
 * `actionlint` + `zizmor` зовнішніми тулчейнами і **викликає цю ж `check()`** —
 * тобто rego-частина живе тут, не в `lint-ga.mjs`.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx detector-контекст (cwd, ruleId, concernId)
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} порушення concern-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const cwd = ctx.cwd

  // Зовнішні тули (read-only): actionlint + zizmor. 127 = тул відсутній → skip.
  ensureTool('shellcheck')
  ensureTool('conftest')
  const stepOpts = { verbose: ctx.verbose === true }
  const actionlintCode = runLintStep('actionlint', 'bunx', ['github-actionlint'], stepOpts)
  if (actionlintCode !== 0 && actionlintCode !== 127) fail('actionlint знайшов порушення (ga.mdc)', 'actionlint')
  if (resolveCmd('uv')) {
    const zizmorCode = runLintStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'], stepOpts)
    if (zizmorCode !== 0 && zizmorCode !== 127) fail('zizmor знайшов ризики у workflow (ga.mdc)', 'zizmor')
  }

  const wfDirRel = '.github/workflows'
  const wfDir = join(cwd, wfDirRel)
  if (!existsSync(wfDir)) {
    fail(`Директорія ${wfDirRel} не існує`)
    return reporter.result()
  }

  const files = await readdir(wfDir)
  const ymlWorkflows = files.filter(f => f.endsWith('.yml'))

  // Rego-крок (per-workflow + workflow_common) — оркестрація ga policy sub-concern-ів.
  await runAllGaRego(wfDir, ymlWorkflows, cwd, pass, fail)

  const setupBunDepsActionRel = '.github/actions/setup-bun-deps/action.yml'
  if (!existsSync(join(cwd, setupBunDepsActionRel))) {
    fail(
      `Відсутній ${setupBunDepsActionRel} — запустіть npx @nitra/cursor або скопіюйте з пакету (ga.mdc: composite setup-bun-deps)`
    )
  }

  checkGaWorkflowFiles(wfDirRel, files, pass, fail)

  await checkApplyWorkflow(wfDir, files, 'apply-k8s.yml', '**/k8s/**/*.yaml', pass, fail)
  await checkApplyWorkflow(wfDir, files, 'apply-nats-consumer.yml', '**/consumer.yaml', pass, fail)

  await checkMegalinter(wfDir, ymlWorkflows, wfDirRel, cwd, pass, fail)

  // git-залежна перевірка `on.push.paths` glob-ів (вимагає `git ls-files`) — лишається в JS.
  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    const parsed = parseWorkflowYaml(content)
    if (parsed) verifyWorkflowEventPathsGlobsExist(`${wfDirRel}/${f}`, parsed, pass, fail, cwd)
    verifyNoBareNCursor(`${wfDirRel}/${f}`, content, fail)
  }

  checkShellcheckInstalled(pass, fail)

  return reporter.result()
}
