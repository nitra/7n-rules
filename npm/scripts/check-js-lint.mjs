/**
 * Перевіряє лінт JavaScript за правилом js-lint.mdc.
 *
 * Канонічний `lint-js`, flat ESLint з getConfig і ignore для auto-imports, рекомендації VSCode,
 * `.oxlintrc.json` має збігатися з каноном oxlint у пакеті (`npm/scripts/utils/oxlint-canonical.json`):
 * plugins, jsPlugins, categories, усі правила з канону (додаткові записи в `rules` дозволені), settings, env,
 * globals, ignorePatterns. `@nitra/eslint-config` у devDependencies мінімум **3.6.12** (транзитивний
 * `@e18e/eslint-plugin` для oxlint), `.jscpd.json` (gitignore, exitCode, reporters, minLines), workflow
 * `lint-js.yml` (checkout@v6, setup-bun-deps, bunx без --fix), без prettier, `engines.node` >= 24,
 * `engines.bun` >= 1.3, `"type": "module"` у кореневому і всіх workspace `package.json`. Дубль перевірки JS у `lint.yml` — заборонено.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseWorkflowYaml, verifyLintJsWorkflowStructure } from './utils/gha-workflow.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'

/** Шлях до канонічного oxlint JSON у цьому пакеті (для перевірки та тестів). */
export const OXLINT_CANONICAL_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'utils',
  'oxlint-canonical.json'
)

/** Очікуваний локальний скрипт. */
export const CANONICAL_LINT_JS = 'bunx oxlint --fix && bunx eslint --fix . && bunx jscpd .'

/** Мінімальні рекомендації розширень редактора з js-lint.mdc (eslint, oxlint, GA). */
export const REQUIRED_VSCODE_EXTENSIONS = ['dbaeumer.vscode-eslint', 'github.vscode-github-actions', 'oxc.oxc-vscode']

const WHITESPACE_RE = /\s+/gu
const NON_DIGITS_RE = /\D+/u
const OXLINT_FIX_RE = /bunx\s+oxlint[^\n]*--fix/u

/**
 * Нормалізує рядок скрипта для порівняння (зайві пробіли).
 * @param {string} s вихідний рядок скрипта `lint-js`
 * @returns {string} рядок без зайвих пробілів на краях і з одиничними пробілами всередині
 */
export function normalizeLintJsScript(s) {
  return String(s).trim().replaceAll(WHITESPACE_RE, ' ')
}

/**
 * Чи рядок `lint-js` збігається з каноном (`bunx oxlint`, `bunx eslint`, `bunx jscpd`).
 * @param {string} script значення `scripts.lint-js` з package.json
 * @returns {boolean} true, якщо рядок канонічний
 */
export function isCanonicalLintJs(script) {
  return normalizeLintJsScript(script) === CANONICAL_LINT_JS
}

/**
 * Чи діапазон `@nitra/eslint-config` у `package.json` передбачає версію з транзитивним `@e18e/eslint-plugin` (>=3.6.12).
 * @param {unknown} versionSpec значення `devDependencies['@nitra/eslint-config']`
 * @returns {boolean} true для `workspace:*` або першої semver у рядку >= 3.6.12
 */
export function nitraEslintConfigDeclaresE18eTransitive(versionSpec) {
  const s = String(versionSpec).trim()
  if (s.startsWith('workspace:')) {
    return true
  }
  const parts = s.split(NON_DIGITS_RE).filter(Boolean)
  if (parts.length < 3) {
    return false
  }
  const [major, minor, patch] = parts.slice(0, 3).map(Number)
  if ([major, minor, patch].some(n => Number.isNaN(n))) {
    return false
  }
  return major > 3 || (major === 3 && minor > 5) || (major === 3 && minor === 5 && patch >= 0)
}

/**
 * Рекурсивне порівняння фрагментів канону oxlint (масиви — порядок як у каноні; об’єкти — той самий набір ключів і вкладеність).
 * @param {unknown} actual значення з `.oxlintrc.json`
 * @param {unknown} expected значення з канону
 * @returns {boolean} true, якщо значення збігаються за правилами канону
 */
function deepEqualOxlintCanonical(actual, expected) {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    return false
  }
  const exp = /** @type {Record<string, unknown>} */ (expected)
  const act = /** @type {Record<string, unknown>} */ (actual)
  const expKeys = Object.keys(exp)
  const actKeys = Object.keys(act)
  if (expKeys.length !== actKeys.length) {
    return false
  }
  for (const k of expKeys) {
    if (!(k in act) || !deepEqualOxlintCanonical(act[k], exp[k])) {
      return false
    }
  }
  return true
}

/**
 * Безпечний доступ як до plain-object запису.
 * @param {unknown} v будь-яке значення
 * @returns {Record<string, unknown>} запис або пустий обʼєкт, якщо `v` не plain-object
 */
function asRecordOrEmpty(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}

/**
 * Звіряє блок `rules`: кожне правило з канону має точне збіжне значення в actual.
 * @param {unknown} expected канонічне значення для `rules`
 * @param {unknown} actual поточне значення для `rules`
 * @param {string[]} failures буфер для помилок
 */
function compareOxlintRules(expected, actual, failures) {
  const er = asRecordOrEmpty(expected)
  const ar = asRecordOrEmpty(actual)
  for (const ruleKey of Object.keys(er)) {
    if (ar[ruleKey] !== er[ruleKey]) {
      failures.push(
        `.oxlintrc.json: rules["${ruleKey}"] очікується ${JSON.stringify(er[ruleKey])}, зараз ${JSON.stringify(ar[ruleKey])}`
      )
    }
  }
}

/**
 * Перевіряє `.oxlintrc.json` проти канону пакета `@nitra/cursor` (усі правила з канону та інші поля з `oxlint-canonical.json`).
 * Додаткові ключі лише в `rules` дозволені; інші поля мають збігатися з каноном.
 * @param {unknown} cfg корінь JSON з `.oxlintrc.json`
 * @param {unknown} canonical розпарений `oxlint-canonical.json`
 * @returns {{ ok: boolean, failures: string[] }} статус і повідомлення для `fail`
 */
export function verifyOxlintRcAgainstCanonical(cfg, canonical) {
  const failures = []
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, failures: ['.oxlintrc.json: корінь має бути значенням типу object'] }
  }
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    return { ok: false, failures: ['внутрішня помилка: канон oxlint має бути object'] }
  }
  const o = /** @type {Record<string, unknown>} */ (cfg)
  const c = /** @type {Record<string, unknown>} */ (canonical)

  for (const key of Object.keys(c)) {
    const expected = c[key]
    const actual = o[key]

    if (key === 'rules') {
      compareOxlintRules(expected, actual, failures)
      continue
    }

    if (!deepEqualOxlintCanonical(actual, expected)) {
      failures.push(
        `.oxlintrc.json: поле "${key}" має збігатися з каноном пакета @nitra/cursor (npm/scripts/utils/oxlint-canonical.json)`
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

/**
 * Перевіряє ESLint flat config файл.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkEslintConfig(passFn, failFn) {
  let eslintPath
  if (existsSync('eslint.config.js')) {
    eslintPath = 'eslint.config.js'
    passFn('eslint.config.js існує')
  } else if (existsSync('eslint.config.mjs')) {
    eslintPath = 'eslint.config.mjs'
    passFn('eslint.config.mjs існує')
  } else {
    failFn('Відсутній eslint.config.js або eslint.config.mjs — flat config з getConfig (js-lint.mdc)')
    return
  }
  const eslintRaw = await readFile(eslintPath, 'utf8')
  const checks = [
    {
      needle: 'getConfig',
      ok: `${eslintPath}: містить getConfig`,
      err: `${eslintPath}: потрібен виклик getConfig (js-lint.mdc)`
    },
    {
      needle: '@nitra/eslint-config',
      ok: `${eslintPath}: імпорт @nitra/eslint-config`,
      err: `${eslintPath}: імпортуй getConfig з @nitra/eslint-config`
    },
    {
      needle: '**/auto-imports.d.ts',
      ok: `${eslintPath}: ignores містить **/auto-imports.d.ts`,
      err: `${eslintPath}: додай у ignores запис **/auto-imports.d.ts (js-lint.mdc)`
    }
  ]
  for (const { needle, ok, err } of checks) {
    if (eslintRaw.includes(needle)) {
      passFn(ok)
    } else {
      failFn(err)
    }
  }
}

/**
 * Перевіряє залежності lint-js у package.json (prettier, `@nitra/eslint-config`).
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkg parsed package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkPackageJsonLintDeps(pkg, passFn, failFn) {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (allDeps.prettier) {
    failFn('package.json: видали залежність prettier (oxfmt замість prettier, js-lint.mdc)')
  } else {
    passFn('package.json не містить prettier')
  }
  if (allDeps['@nitra/prettier-config']) {
    failFn('package.json: видали @nitra/prettier-config (js-lint.mdc)')
  } else {
    passFn('package.json не містить @nitra/prettier-config')
  }

  const nitraEslint = pkg.devDependencies?.['@nitra/eslint-config']
  if (nitraEslint) {
    passFn('@nitra/eslint-config є в devDependencies')
    if (nitraEslintConfigDeclaresE18eTransitive(nitraEslint)) {
      passFn(
        '@nitra/eslint-config: мінімум 3.6.12 (транзитивний @e18e/eslint-plugin для oxlint jsPlugins, js-lint.mdc)'
      )
    } else {
      failFn(
        '@nitra/eslint-config: онови до мінімум "^3.6.12" — з цієї версії постачається @e18e/eslint-plugin для .oxlintrc.json (js-lint.mdc)'
      )
    }
  } else {
    failFn('@nitra/eslint-config відсутній в devDependencies — додай: bun add -d @nitra/eslint-config')
  }
}

/**
 * Перевіряє, що package.json має `"type": "module"`.
 * @param {string} label шлях або назва пакета для повідомлень
 * @param {{ type?: string }} pkg parsed package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkPackageJsonTypeModule(label, pkg, passFn, failFn) {
  if (pkg.type === 'module') {
    passFn(`${label}: "type": "module"`)
  } else {
    failFn(`${label}: має містити "type": "module" (js-lint.mdc)`)
  }
}

/**
 * `"type": "module"`, `engines.node >= 24` і `engines.bun >= 1.3` у кожному workspace `package.json`.
 * @param {unknown[]} workspaces поле workspaces з package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkWorkspacePackages(workspaces, passFn, failFn) {
  for (const ws of workspaces) {
    const wsPkgPath = `${ws}/package.json`
    if (existsSync(wsPkgPath)) {
      const wsPkg = JSON.parse(await readFile(wsPkgPath, 'utf8'))
      checkPackageJsonTypeModule(wsPkgPath, wsPkg, passFn, failFn)
      checkEnginesNode(wsPkgPath, wsPkg, passFn, failFn)
      checkEnginesBun(wsPkgPath, wsPkg, passFn, failFn)
    }
  }
}

/**
 * engines.node >= 24.
 * @param {string} label шлях або назва пакета для повідомлень
 * @param {{ engines?: { node?: string } }} pkg розпарсений package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkEnginesNode(label, pkg, passFn, failFn) {
  const nodeEngine = pkg.engines?.node
  if (nodeEngine) {
    const firstNumeric = String(nodeEngine).split(NON_DIGITS_RE).find(Boolean)
    if (firstNumeric && Number(firstNumeric) >= 24) {
      passFn(`${label}: engines.node "${nodeEngine}"`)
    } else {
      failFn(`${label}: engines.node "${nodeEngine}" — має бути >=24`)
    }
  } else {
    failFn(`${label} не містить engines.node — додай: "engines": { "node": ">=24" }`)
  }
}

/**
 * engines.bun >= 1.3.
 * @param {string} label шлях або назва пакета для повідомлень
 * @param {{ engines?: { bun?: string } }} pkg розпарсений package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkEnginesBun(label, pkg, passFn, failFn) {
  const bunEngine = pkg.engines?.bun
  if (bunEngine) {
    const [major, minor] = String(bunEngine).split(NON_DIGITS_RE).filter(Boolean).map(Number)
    if (Number.isFinite(major) && Number.isFinite(minor) && (major > 1 || (major === 1 && minor >= 3))) {
      passFn(`${label}: engines.bun "${bunEngine}"`)
    } else {
      failFn(`${label}: engines.bun "${bunEngine}" — має бути >=1.3`)
    }
  } else {
    failFn(`${label} не містить engines.bun — додай: "engines": { "bun": ">=1.3" }`)
  }
}

/**
 * Перевіряє package.json на lint-js, prettier, eslint-config, engines.node.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkPackageJsonJsLint(passFn, failFn) {
  if (!existsSync('package.json')) return
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))

  checkPackageJsonTypeModule('package.json', pkg, passFn, failFn)

  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
  await checkWorkspacePackages(workspaces, passFn, failFn)

  const lintJs = pkg.scripts?.['lint-js']
  if (lintJs) {
    passFn('package.json містить скрипт lint-js')
    if (isCanonicalLintJs(String(lintJs))) {
      passFn(`lint-js збігається з каноном: ${CANONICAL_LINT_JS}`)
    } else {
      failFn(
        `lint-js має бути рівно: "${CANONICAL_LINT_JS}" (див. js-lint.mdc / check-js-lint.mjs). Зараз: ${JSON.stringify(normalizeLintJsScript(String(lintJs)))}`
      )
    }
  } else {
    failFn(`package.json не містить скрипт "lint-js" — додай: ${JSON.stringify(CANONICAL_LINT_JS)}`)
  }

  checkPackageJsonLintDeps(pkg, passFn, failFn)
  checkEnginesNode('package.json', pkg, passFn, failFn)
  checkEnginesBun('package.json', pkg, passFn, failFn)
}

/**
 * Перевіряє .oxlintrc.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkOxlintRc(passFn, failFn) {
  if (!existsSync('.oxlintrc.json')) {
    failFn('.oxlintrc.json не існує — додай конфіг oxlint (js-lint.mdc)')
    return
  }
  let oxCfg
  try {
    oxCfg = JSON.parse(await readFile('.oxlintrc.json', 'utf8'))
  } catch {
    failFn('.oxlintrc.json не є валідним JSON')
    return
  }
  passFn('.oxlintrc.json існує')
  let canonical
  try {
    canonical = JSON.parse(await readFile(OXLINT_CANONICAL_JSON_PATH, 'utf8'))
  } catch {
    failFn('внутрішня помилка: не вдалося прочитати канон oxlint з пакета @nitra/cursor')
    return
  }
  const oxV = verifyOxlintRcAgainstCanonical(oxCfg, canonical)
  if (oxV.ok) {
    passFn('.oxlintrc.json збігається з каноном oxlint (@nitra/cursor)')
  } else {
    for (const msg of oxV.failures) {
      failFn(msg)
    }
  }
}

/**
 * Перевіряє .vscode/extensions.json на потрібні розширення.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkVscodeExtensions(passFn, failFn) {
  if (!existsSync('.vscode/extensions.json')) {
    failFn('.vscode/extensions.json не існує — додай recommendations з js-lint.mdc (див. check-js-lint.mjs)')
    return
  }
  let ext
  try {
    ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
  } catch {
    failFn('.vscode/extensions.json не є валідним JSON')
    return
  }
  const rec = ext.recommendations
  if (!Array.isArray(rec)) {
    failFn('.vscode/extensions.json: поле recommendations має бути масивом')
    return
  }
  const missing = REQUIRED_VSCODE_EXTENSIONS.filter(id => !rec.includes(id))
  if (missing.length > 0) {
    failFn(`.vscode/extensions.json: додай у recommendations: ${missing.join(', ')} (мінімум для js-lint.mdc)`)
  } else {
    passFn('.vscode/extensions.json: є рекомендації oxlint, eslint і GitHub Actions')
  }
}

/**
 * Перевіряє lint-js.yml workflow (fallback — текстовий пошук).
 * @param {string} content вміст workflow файлу
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkLintJsWorkflowFallback(content, passFn, failFn) {
  const checks = [
    ['actions/checkout@v6', 'lint-js.yml: потрібен крок actions/checkout@v6 (ga.mdc)'],
    ['persist-credentials: false', 'lint-js.yml: checkout з persist-credentials: false'],
    ['./.github/actions/setup-bun-deps', 'lint-js.yml: потрібен uses: ./.github/actions/setup-bun-deps'],
    ['bunx oxlint', 'lint-js.yml: у run має бути bunx oxlint'],
    ['bunx eslint .', 'lint-js.yml: у run має бути bunx eslint . (без --fix у CI)'],
    ['bunx jscpd .', 'lint-js.yml: у run має бути bunx jscpd .']
  ]
  for (const [needle, errMsg] of checks) {
    if (content.includes(needle)) {
      passFn(`lint-js.yml містить: ${needle}`)
    } else {
      failFn(errMsg)
    }
  }
  if (content.includes('bunx oxlint') && OXLINT_FIX_RE.test(content)) {
    failFn('lint-js.yml: у CI не використовуй bunx oxlint --fix (лише bunx oxlint)')
  }
  if (content.includes('eslint --fix')) {
    failFn('lint-js.yml: у CI не використовуй eslint --fix (лише bunx eslint .)')
  }
}

/**
 * Перевіряє вміст lint-js.yml через YAML або fallback.
 * @param {string} content вміст файлу
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkLintJsYmlContent(content, passFn, failFn) {
  const root = parseWorkflowYaml(content)
  if (root) {
    const v = verifyLintJsWorkflowStructure(root)
    if (v.ok) {
      passFn('lint-js.yml: кроки checkout, setup-bun-deps, oxlint/eslint/jscpd (YAML + кроки)')
    } else {
      for (const msg of v.failures) {
        failFn(`lint-js.yml: ${msg}`)
      }
    }
  } else {
    checkLintJsWorkflowFallback(content, passFn, failFn)
  }
}

/**
 * Перевіряє lint-js.yml і lint.yml workflow.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkLintJsWorkflows(passFn, failFn) {
  if (existsSync('.github/workflows/lint-js.yml')) {
    const content = await readFile('.github/workflows/lint-js.yml', 'utf8')
    passFn('lint-js.yml існує')
    checkLintJsYmlContent(content, passFn, failFn)
  } else {
    failFn('.github/workflows/lint-js.yml не існує — створи його (див. check-js-lint.mjs / js-lint.mdc)')
  }

  if (existsSync('.github/workflows/lint.yml')) {
    const lintYml = await readFile('.github/workflows/lint.yml', 'utf8')
    if (lintYml.includes('bunx oxlint') && lintYml.includes('bunx eslint') && lintYml.includes('jscpd')) {
      failFn('.github/workflows/lint.yml дублює кроки lint-js.yml — залиш один workflow на лінт JS (js-lint.mdc)')
    } else {
      passFn('.github/workflows/lint.yml не дублює oxlint/eslint/jscpd з lint-js.yml')
    }
  }
}

/**
 * Перевіряє .jscpd.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkJscpdConfig(passFn, failFn) {
  if (!existsSync('.jscpd.json')) {
    failFn('.jscpd.json не існує — створи з полями згідно check js-lint')
    return
  }
  let jscpdCfg
  try {
    jscpdCfg = JSON.parse(await readFile('.jscpd.json', 'utf8'))
  } catch {
    failFn('.jscpd.json не є валідним JSON')
    return
  }
  passFn('.jscpd.json існує')
  if (jscpdCfg.gitignore === true) {
    passFn('.jscpd.json: gitignore увімкнено')
  } else {
    failFn('.jscpd.json має містити "gitignore": true')
  }
  if (jscpdCfg.exitCode === 1) {
    passFn('.jscpd.json: exitCode 1 при дублікатах')
  } else {
    failFn('.jscpd.json має містити "exitCode": 1 (інакше CI не впаде на клонах)')
  }
  if (Array.isArray(jscpdCfg.reporters) && jscpdCfg.reporters.includes('console')) {
    passFn('.jscpd.json: reporters містить console')
  } else {
    failFn('.jscpd.json має містити "reporters": ["console"] (або масив із "console")')
  }
  const minLines = jscpdCfg.minLines
  if (typeof minLines === 'number' && minLines >= 25) {
    passFn(`.jscpd.json: minLines ${minLines} (>=25)`)
  } else {
    failFn('.jscpd.json має містити "minLines" як число >= 25')
  }
}

/**
 * Перевіряє відповідність проєкту правилам js-lint.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkEslintConfig(pass, fail)
  await checkPackageJsonJsLint(pass, fail)
  await checkOxlintRc(pass, fail)
  await checkVscodeExtensions(pass, fail)
  await checkLintJsWorkflows(pass, fail)
  await checkJscpdConfig(pass, fail)

  for (const dup of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']) {
    if (existsSync(dup)) fail(`Знайдено застарілий конфіг ESLint: ${dup} — видали, використовуй flat config`)
  }

  return reporter.getExitCode()
}
