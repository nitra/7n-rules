/**
 * Перевіряє GitHub Actions за правилом ga.mdc.
 *
 * Workflows лише з розширенням `.yml`, наявність clean/lint workflow, конфіг zizmor з ref-pin,
 * відсутність MegaLinter, коректний скрипт `lint-ga` у `package.json`, виклик у `lint-ga.yml`,
 * наявність composite `.github/actions/setup-bun-deps/action.yml` (його записує npx `\@nitra/cursor`),
 * `\.vscode/settings.json` — `editor.defaultFormatter` **oxc** для `[github-actions-workflow]`.
 *
 * Структурні поля 4 канонічних workflow (`clean-ga-workflows.yml`, `clean-merged-branch.yml`,
 * `lint-ga.yml`, `git-ai.yml`) і УНІВЕРСАЛЬНІ перевірки для всіх `.github/workflows/*.yml`
 * (`concurrency`, заборонені `oven-sh/setup-bun` / `actions/cache` / `bun install` у `uses`/`run`,
 * shell-продовження `\` у `run`, обов'язковий `actions/checkout@v6` перед локальним
 * `setup-bun-deps`) — у Rego-полісі під `npm/policy/ga/` і запускаються через
 * `bun run lint-ga` (`runConftestStep` у `lint-ga.mjs`). Тут лишилася лише git-залежна
 * перевірка `on.*.paths` glob-ів через `git ls-files :(glob)`.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import { eventPathsIncludeExact, parseWorkflowYaml } from './utils/gha-workflow.mjs'
import { resolveCmd } from './utils/resolve-cmd.mjs'

/** Шаблони наявності MegaLinter у вмісті workflow */
const MEGALINTER_USE_PATTERNS = [/oxsecurity\/megalinter-action/i, /megalinter\/megalinter/i]

/** Типові конфіги MegaLinter у корені репо */
const MEGALINTER_CONFIG_NAMES = ['.mega-linter.yml', '.megalinter.yaml', '.mega-linter.yaml']

const N_CURSOR_LINT_GA_RE = /\bn-cursor\s+lint-ga\b/

/** Обовʼязкові workflow-файли (ga.mdc). */
const REQUIRED_WORKFLOWS = ['clean-ga-workflows.yml', 'clean-merged-branch.yml', 'lint-ga.yml', 'git-ai.yml']

/**
 * Повертає true, якщо glob у GitHub Actions `on.*.paths` матчитсья хоча б на один tracked файл у репозиторії.
 *
 * Використовує `git ls-files` з pathspec-магiєю `:(glob)`, щоб не реалізовувати glob engine вручну
 * і не сканувати файлову систему рекурсивно.
 * @param {string} globPattern glob з workflow (наприклад "files/**" або "image-migration-new/**")
 * @returns {boolean} true, якщо є хоча б один збіг
 */
function gitHasAnyTrackedFileMatchingGlob(globPattern) {
  const p = String(globPattern ?? '').trim()
  if (!p) return false
  if (p.startsWith('!')) return true
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git як стандартне dev-середовище через PATH; альтернативи (хардкод шляху) непортативні
    const out = execFileSync('git', ['ls-files', '-z', '--', `:(glob)${p}`], { encoding: 'utf8' })
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
  if (p.includes('*.')) return false

  return true
}

/**
 * Перевіряє один glob з `on.<event>.paths` на наявність збігів у репо.
 * @param {string} relPath шлях workflow для повідомлень
 * @param {string} eventName назва події (push / pull_request)
 * @param {unknown} raw сирий елемент масиву paths
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
function verifyOnePathsGlob(relPath, eventName, raw, passFn, failFn) {
  const p = String(raw ?? '').trim()
  if (!p) return
  if (!shouldValidateWorkflowPathsGlob(p)) {
    passFn(`${relPath}: on.${eventName}.paths glob пропущено для перевірки існування: ${JSON.stringify(p)}`)
    return
  }
  if (gitHasAnyTrackedFileMatchingGlob(p)) {
    passFn(`${relPath}: on.${eventName}.paths glob матчитсья: ${JSON.stringify(p)}`)
  } else {
    failFn(`${relPath}: on.${eventName}.paths glob не матчитсья ні на один файл: ${JSON.stringify(p)}`)
  }
}

/**
 * Валідує `on.push.paths` / `on.pull_request.paths`: кожен позитивний glob має мати збіги в репозиторії.
 * @param {string} relPath шлях workflow для повідомлень
 * @param {Record<string, unknown>} root parsed YAML workflow
 * @param {(msg: string) => void} passFn pass
 * @param {(msg: string) => void} failFn fail
 */
function verifyWorkflowEventPathsGlobsExist(relPath, root, passFn, failFn) {
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
      verifyOnePathsGlob(relPath, eventName, raw, passFn, failFn)
    }
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
  // Канонічний скрипт делегує виконання CLI `n-cursor lint-ga` (bin з `@nitra/cursor`) — там preflight
  // на shellcheck + послідовно `bunx github-actionlint` і `uvx zizmor --offline --collect=workflows .`.
  // Виклик через bin-ім’я `n-cursor`, а не `npx --no @nitra/cursor`, бо `bun run` транслює `npx` у `bun x`,
  // а `bun x @nitra/cursor` для скоупованого пакету з одним bin-ім’ям повертає 0 без виконання.
  if (N_CURSOR_LINT_GA_RE.test(lg)) {
    passFn('lint-ga делегує CLI n-cursor lint-ga (preflight shellcheck + actionlint + zizmor)')
  } else {
    failFn('lint-ga має бути "n-cursor lint-ga" — CLI робить preflight shellcheck перед actionlint/zizmor (ga.mdc)')
  }
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
function checkShellcheckInstalled(passFn, failFn) {
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

  // Універсальні структурні перевірки (concurrency, заборонені setup-bun/cache,
  // shell line-continuation `\`, checkout перед локальним setup-bun-deps)
  // перенесено в Rego (`npm/policy/ga/workflow_common/`); їх запускає
  // `bun run lint-ga` через conftest. Тут лишилася лише git-залежна перевірка
  // `on.push.paths` glob-ів (вимагає `git ls-files`).
  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    const parsed = parseWorkflowYaml(content)
    if (parsed) {
      verifyWorkflowEventPathsGlobsExist(`${wfDir}/${f}`, parsed, pass, fail)
    }
  }

  await checkZizmor(pass, fail)
  await checkLintGaScript(pass, fail)
  checkShellcheckInstalled(pass, fail)

  return reporter.getExitCode()
}
