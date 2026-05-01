/**
 * Перевіряє текстовий стек і форматування за правилом text.mdc.
 *
 * oxfmt: `.oxfmtrc.json` з обовʼязковими ключами та масивом ignorePatterns (два канонічні glob-и з text.mdc для hasura metadata і schema.graphql),
 * VSCode (formatOnSave, defaultFormatter для js/ts/json/vue/css/html),
 * відсутність Prettier у конфігах і залежностях.
 *
 * cspell: `.cspell.json` з обовʼязковим набором `ignorePaths` (клон text.mdc: node_modules, vscode, git, report, svg, k8s yaml);
 * cspell, markdownlint через `bunx markdownlint-cli2` у `lint-text` (без оголошення пакета в package.json); у кореневих **`devDependencies`**
 * дозволені лише **`@nitra/*`** (як у bun.mdc), зокрема **`@nitra/cspell-dict` ^2.0.0+**; без імпорту **`@cspell/dict-*`** у `.cspell.json`, заборона
 * `markdownlint-cli2` у dependencies/devDependencies, v8r (`run-v8r.mjs` або чотири `bunx v8r`),
 * `.v8rignore` (vscode JSON),
 * workflow `lint-text.yml`, розширення VSCode (markdownlint, oxc).
 *
 * Якщо є `.cursor/rules/n-text.mdc` і/або `npm/mdc/text.mdc` — перевіряє наявність абзацу про український
 * апостроф (U+0027 vs U+2019) і приклад з символом U+2019 у тексті.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { isAllowedRootDevDependency } from './check-bun.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { anyRunStepIncludes, parseWorkflowYaml } from './utils/gha-workflow.mjs'

const WORKSPACE_STAR_RE = /^workspace:\*/
const VERSION_PREFIX_RE = /^[\^~>=<]+\s*/
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/

/** Заголовок абзацу про апостроф у text.mdc / n-text.mdc. */
const UK_APOSTROPHE_HEADING = '**Український апостроф:**'

/** Мінімальні glob-и в `ignorePatterns` у `.oxfmtrc.json` (text.mdc) — додаткові патерни локально дозволені. */
const OXFMT_REQUIRED_IGNORE_PATTERNS = ['**/hasura/metadata/**', '**/schema.graphql', '**/auto-imports.d.ts']

/** Канонічні записи `ignorePaths` у `.cspell.json` (text.mdc) — кожен має бути присутнім. */
const CSPELL_REQUIRED_IGNORE_PATHS = [
  '**/node_modules/**',
  '**/vscode-extension/**',
  '**/.git/**',
  '.vscode',
  'report',
  '*.svg',
  '**/k8s/**/*.yaml'
]

/**
 * Чи діапазон версії `@nitra/cspell-dict` у package.json означає лінію 2.0.0+ (з цієї версії словники входять у пакет).
 * @param {string|undefined} range наприклад "^2.0.0"
 * @returns {boolean} true якщо мажорна версія >= 2
 */
function cspellDictVersionAtLeast200(range) {
  if (typeof range !== 'string' || !range.trim()) return false
  const cleaned = range.trim().replace(WORKSPACE_STAR_RE, '').replace(VERSION_PREFIX_RE, '')
  const m = cleaned.match(SEMVER_RE)
  if (!m) return false
  const major = Number(m[1])
  return major >= 2
}

/**
 * Перевіряє абзац про український апостроф у вмісті правила text.
 * @param {string} filePath шлях до файлу (для повідомлень)
 * @param {string} body вміст .mdc у UTF-8
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyUkApostropheRuleParagraph(filePath, body, failFn, passFn) {
  if (!body.includes(UK_APOSTROPHE_HEADING)) {
    failFn(`${filePath}: додай абзац **Український апостроф:** (U+0027 / U+2019, масив words) — див. text.mdc`)
    return
  }
  if (!body.includes('U+0027') || !body.includes('U+2019')) {
    failFn(`${filePath}: абзац про апостроф має містити позначки U+0027 та U+2019`)
    return
  }
  if (!body.includes('\u2019')) {
    failFn(`${filePath}: у прикладі має бути типографський символ U+2019 (\u2019)`)
    return
  }
  passFn(`${filePath}: абзац про український апостроф на місці`)
}

/**
 * Перевіряє .v8rignore.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkV8rIgnore(passFn, failFn) {
  const required = ['.vscode/extensions.json', '.vscode/settings.json']
  if (!existsSync('.v8rignore')) {
    failFn('.v8rignore не існує — створи згідно n-text.mdc (мінімум .vscode/extensions.json і .vscode/settings.json)')
    return
  }
  const raw = await readFile('.v8rignore', 'utf8')
  const lines = new Set(
    raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'))
  )
  for (const path of required) {
    if (lines.has(path)) {
      passFn(`.v8rignore містить ${path}`)
    } else {
      failFn(`.v8rignore: додай рядок "${path}" (JSON без схеми в Schema Store — див. n-text.mdc)`)
    }
  }
}

/**
 * Перевіряє VSCode extensions.json для текстового стека.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkVscodeTextExtensions(passFn, failFn) {
  if (!existsSync('.vscode/extensions.json')) {
    failFn('.vscode/extensions.json не існує — створи з recommendations згідно n-text.mdc')
    return
  }
  try {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    const rec = ext.recommendations
    for (const id of ['DavidAnson.vscode-markdownlint', 'oxc.oxc-vscode']) {
      if (Array.isArray(rec) && rec.includes(id)) {
        passFn(`extensions.json містить ${id}`)
      } else {
        failFn(`extensions.json: додай "${id}" у recommendations (див. n-text.mdc)`)
      }
    }
  } catch {
    failFn('.vscode/extensions.json — невалідний JSON')
  }
}

/**
 * Перевіряє VSCode settings.json для текстового стека.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkVscodeTextSettings(passFn, failFn) {
  if (!existsSync('.vscode/settings.json')) {
    failFn('.vscode/settings.json не існує — створи згідно n-text.mdc')
    return
  }
  try {
    const settings = JSON.parse(await readFile('.vscode/settings.json', 'utf8'))
    if (settings['editor.formatOnSave'] === true) {
      passFn('settings.json: editor.formatOnSave увімкнено')
    } else {
      failFn('settings.json: editor.formatOnSave має бути true')
    }
    for (const t of ['javascript', 'typescript', 'json', 'vue', 'css', 'html']) {
      const key = `[${t}]`
      if (settings[key]?.['editor.defaultFormatter'] === 'oxc.oxc-vscode') {
        passFn(`settings.json: ${key} використовує oxc.oxc-vscode`)
      } else {
        failFn(`settings.json: ${key} має використовувати oxc.oxc-vscode як defaultFormatter`)
      }
    }
  } catch {
    failFn('.vscode/settings.json — невалідний JSON')
  }
}

/**
 * Перевіряє VSCode extensions.json та settings.json для текстового стека.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkVscodeText(passFn, failFn) {
  await checkVscodeTextExtensions(passFn, failFn)
  await checkVscodeTextSettings(passFn, failFn)
}

/**
 * Перевіряє .oxfmtrc.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkOxfmtRc(passFn, failFn) {
  if (!existsSync('.oxfmtrc.json')) {
    failFn('.oxfmtrc.json не існує — створи його')
    return
  }
  const cfg = JSON.parse(await readFile('.oxfmtrc.json', 'utf8'))
  const requiredKeys = [
    'arrowParens',
    'printWidth',
    'bracketSpacing',
    'bracketSameLine',
    'semi',
    'singleQuote',
    'tabWidth',
    'trailingComma',
    'useTabs'
  ]
  const missing = requiredKeys.filter(k => !(k in cfg))
  if (missing.length === 0) {
    passFn('.oxfmtrc.json містить всі обовʼязкові ключі')
  } else {
    failFn(`.oxfmtrc.json відсутні ключі: ${missing.join(', ')}`)
  }
  if (cfg.semi !== false) failFn('.oxfmtrc.json: semi має бути false')
  if (cfg.singleQuote !== true) failFn('.oxfmtrc.json: singleQuote має бути true')
  if (cfg.tabWidth !== 2) failFn('.oxfmtrc.json: tabWidth має бути 2')
  if (cfg.useTabs !== false) failFn('.oxfmtrc.json: useTabs має бути false')
  if (cfg.printWidth !== 120) failFn('.oxfmtrc.json: printWidth має бути 120')

  if (Array.isArray(cfg.ignorePatterns)) {
    const set = new Set(cfg.ignorePatterns)
    const missingPatterns = OXFMT_REQUIRED_IGNORE_PATTERNS.filter(p => !set.has(p))
    if (missingPatterns.length === 0) {
      passFn('.oxfmtrc.json: ignorePatterns містить hasura/metadata, schema.graphql і auto-imports.d.ts')
    } else {
      failFn(
        `.oxfmtrc.json ignorePatterns: додай відсутні елементи: ${missingPatterns.join(', ')} (канонічний приклад у text.mdc)`
      )
    }
  } else {
    failFn(`.oxfmtrc.json: додай масив ignorePatterns з ${OXFMT_REQUIRED_IGNORE_PATTERNS.join(', ')} (див. text.mdc)`)
  }
}

/**
 * Перевіряє залежності package.json для текстового стека.
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string>, prettier?: unknown }} pkg розібраний package.json
 * @param {Record<string, string>} devDeps devDependencies з package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkPackageJsonTextDepsUsage(pkg, devDeps, passFn, failFn) {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const dep of ['prettier', '@nitra/prettier-config']) {
    if (allDeps[dep]) failFn(`package.json містить залежність ${dep} — видали її`)
  }
  if (pkg.prettier) failFn('package.json містить поле "prettier" — видали його')

  const nonNitraDev = Object.keys(devDeps).filter(n => !isAllowedRootDevDependency(n))
  if (nonNitraDev.length > 0) {
    failFn(
      `Кореневі devDependencies: дозволені лише @nitra/* — прибери або перенеси: ${nonNitraDev.join(', ')} (bun.mdc)`
    )
  } else {
    passFn('Кореневі devDependencies лише @nitra/*')
  }

  const cspellRange = devDeps['@nitra/cspell-dict']
  if (!cspellRange) {
    failFn('@nitra/cspell-dict у devDependencies обовʼязковий для cspell — bun add -d @nitra/cspell-dict@^2.0.0')
  } else if (cspellDictVersionAtLeast200(cspellRange)) {
    passFn('@nitra/cspell-dict ^2.0.0+')
  } else {
    failFn('@nitra/cspell-dict має бути ^2.0.0 або новіший (словники зібрані в пакеті з 2.x)')
  }

  if (devDeps['markdownlint-cli2'] || (pkg.dependencies || {})['markdownlint-cli2']) {
    failFn(
      'markdownlint-cli2 не додавай у dependencies/devDependencies — лише bunx у lint-text (n-text.mdc); прибери з package.json і bun i'
    )
  }
}

/**
 * Перевіряє відсутність прямих імпортів `@cspell/dict-*` у .cspell.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkCspellJsonDictImports(passFn, failFn) {
  if (!existsSync('.cspell.json')) return
  const cfg = JSON.parse(await readFile('.cspell.json', 'utf8'))
  const dictImports = (cfg.import || []).filter(i => typeof i === 'string' && i.includes('@cspell/dict-'))
  if (dictImports.length > 0) {
    failFn(
      `.cspell.json не має імпортувати @cspell/dict-* (${dictImports.join(', ')}) — використовуй лише @nitra/cspell-dict/cspell-ext.json`
    )
  } else {
    passFn('.cspell.json без прямих імпортів @cspell/dict-*')
  }
}

/**
 * Перевіряє package.json для текстового стека.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkPackageJsonText(passFn, failFn) {
  if (!existsSync('package.json')) return
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const devDeps = pkg.devDependencies || {}

  checkPackageJsonTextDepsUsage(pkg, devDeps, passFn, failFn)
  checkLintTextScript(pkg.scripts?.['lint-text'], passFn, failFn)

  if (existsSync('.github/workflows/lint-text.yml')) {
    const wf = await readFile('.github/workflows/lint-text.yml', 'utf8')
    const root = parseWorkflowYaml(wf)
    const ok = root ? anyRunStepIncludes(root, 'bun run lint-text') : wf.includes('bun run lint-text')
    if (ok) {
      passFn('lint-text.yml викликає bun run lint-text')
    } else {
      failFn('lint-text.yml має містити крок bun run lint-text')
    }
  } else {
    failFn('.github/workflows/lint-text.yml не існує — створи згідно n-text.mdc')
  }

  await checkCspellJsonDictImports(passFn, failFn)
}

/**
 * Перевіряє скрипт lint-text на коректність v8r-виклику.
 * @param {unknown} lintText параметр lintText
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkLintTextScript(lintText, passFn, failFn) {
  const lt = typeof lintText === 'string' ? lintText : ''
  const v8rCalls = (lt.match(/bunx v8r/g) || []).length
  const quietCalls = (lt.match(/run-v8r?\.mjs/g) || []).length
  const eq98Hints = (lt.match(/eq 98/g) || []).length
  const legacyV8r = v8rCalls >= 4 && eq98Hints >= 4
  const quietBundled = quietCalls === 1
  const quietLegacy4x = quietCalls >= 4
  const v8rTextOk = legacyV8r || quietBundled || quietLegacy4x
  const globsRequired = legacyV8r || quietLegacy4x
  const globsOk =
    lt.includes('**/*.json') && lt.includes('**/*.yml') && lt.includes('**/*.yaml') && lt.includes('**/*.toml')
  const ok =
    lt &&
    lt.includes('cspell') &&
    lt.includes('bunx markdownlint-cli2') &&
    lt.includes('**/*.mdc') &&
    v8rTextOk &&
    (!globsRequired || globsOk)
  if (ok) {
    passFn('package.json: lint-text — v8r: run-v8r.mjs (один виклик або чотири) або чотири bunx v8r з || [ $? -eq 98 ]')
  } else {
    failFn(
      'package.json: lint-text — v8r: bun ./…/run-v8r.mjs або чотири (bunx v8r "<glob>" || [ $? -eq 98 ]) для json/yml/yaml/toml (див. n-text.mdc)'
    )
  }
}

/**
 * Перевіряє .markdownlint-cli2.jsonc.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkMarkdownlintConfig(pass, fail) {
  if (!existsSync('.markdownlint-cli2.jsonc')) {
    fail('.markdownlint-cli2.jsonc не існує — створи згідно n-text.mdc')
    return
  }
  try {
    const ml = JSON.parse(await readFile('.markdownlint-cli2.jsonc', 'utf8'))
    pass('.markdownlint-cli2.jsonc існує і є валідним JSON')
    if (ml.gitignore === true) {
      pass('.markdownlint-cli2.jsonc: gitignore увімкнено')
    } else {
      fail('.markdownlint-cli2.jsonc: додай на верхньому рівні "gitignore": true (див. n-text.mdc)')
    }
  } catch {
    fail('.markdownlint-cli2.jsonc — невалідний JSON; перевір синтаксис')
  }
}

/**
 * Перевіряє .cspell.json на версію, мову, імпорт і ignorePaths.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkCspellConfig(pass, fail) {
  if (!existsSync('.cspell.json')) {
    fail('.cspell.json не існує — створи його')
    return
  }
  const cfg = JSON.parse(await readFile('.cspell.json', 'utf8'))
  if (cfg.version === '0.2') {
    pass('.cspell.json version: 0.2')
  } else {
    fail('.cspell.json version має бути "0.2"')
  }
  if (cfg.language) {
    pass(`.cspell.json language: "${cfg.language}"`)
  } else {
    fail('.cspell.json не містить поле language')
  }
  if ((cfg.import || []).some(i => i.includes('@nitra/cspell-dict'))) {
    pass('.cspell.json імпортує @nitra/cspell-dict')
  } else {
    fail('.cspell.json не імпортує @nitra/cspell-dict/cspell-ext.json')
  }
  if (Array.isArray(cfg.ignorePaths)) {
    pass('.cspell.json містить ignorePaths')
  } else {
    fail('.cspell.json не містить ignorePaths')
  }
  if (Array.isArray(cfg.ignorePaths)) {
    const missing = CSPELL_REQUIRED_IGNORE_PATHS.filter(p => !cfg.ignorePaths.includes(p))
    if (missing.length === 0) {
      pass(`.cspell.json ignorePaths містить усі обовʼязкові glob-и з text.mdc`)
    } else {
      fail(`.cspell.json ignorePaths бракує за замовчанням: ${missing.join(', ')} (див. text.mdc)`)
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам text.mdc (oxfmt, cspell, markdownlint через bunx, v8r)
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkV8rIgnore(pass, fail)
  await checkVscodeText(pass, fail)
  await checkOxfmtRc(pass, fail)

  for (const f of ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js', '.prettierrc.yml']) {
    if (existsSync(f)) fail(`Знайдено конфіг prettier: ${f} — видали його`)
  }

  await checkMarkdownlintConfig(pass, fail)
  await checkCspellConfig(pass, fail)

  const textRulePaths = ['.cursor/rules/n-text.mdc', 'npm/mdc/text.mdc'].filter(p => existsSync(p))
  if (textRulePaths.length === 0) {
    pass('n-text.mdc / npm/mdc/text.mdc відсутні — перевірку абзацу про апостроф пропущено')
  } else {
    for (const p of textRulePaths) {
      verifyUkApostropheRuleParagraph(p, await readFile(p, 'utf8'), fail, pass)
    }
  }

  await checkPackageJsonText(pass, fail)

  return reporter.getExitCode()
}
