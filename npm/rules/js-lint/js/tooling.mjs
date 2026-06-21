/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Шлях до канонічного oxlint JSON у цьому пакеті (для перевірки та тестів). */
export const OXLINT_CANONICAL_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'tooling',
  'oxlint-canonical.json'
)

/** Шлях до канонічного knip JSON у цьому пакеті — копіюється у корінь проєкту-споживача, якщо відсутній. */
export const KNIP_CANONICAL_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'tooling',
  'knip-canonical.json'
)

const NON_DIGITS_RE = /\D+/u

// Канонічний рядок `lint-js`-скрипта і мінімальна версія `@nitra/eslint-config` —
// у rego (`npm/policy/js_lint/package_json/`). JS-копії (`CANONICAL_LINT_JS`,
// `isCanonicalLintJs`, `nitraEslintConfigMeetsMinVersion`) видалено, щоб не
// було двох джерел істини й ризику дрифту.

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
 * Звіряє блок `ignorePatterns`: кожен патерн із канону має бути присутній в actual; додаткові локальні
 * патерни дозволені (канон задає мінімум, проєкт може розширити).
 * @param {unknown} expected канонічний масив `ignorePatterns`
 * @param {unknown} actual поточний `ignorePatterns` із `.oxlintrc.json`
 * @param {string[]} failures буфер для помилок
 */
function compareOxlintIgnorePatterns(expected, actual, failures) {
  if (!Array.isArray(expected)) {
    return
  }
  if (!Array.isArray(actual)) {
    failures.push(
      '.oxlintrc.json: поле "ignorePatterns" має бути масивом (канон задає мінімум, додаткові патерни дозволені)'
    )
    return
  }
  const set = new Set(actual)
  const missing = expected.filter(p => !set.has(p))
  if (missing.length > 0) {
    failures.push(
      `.oxlintrc.json: ignorePatterns має містити канонічні патерни — додай: ${missing.map(p => JSON.stringify(p)).join(', ')}`
    )
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

    if (key === 'ignorePatterns') {
      compareOxlintIgnorePatterns(expected, actual, failures)
      continue
    }

    if (!deepEqualOxlintCanonical(actual, expected)) {
      failures.push(
        `.oxlintrc.json: поле "${key}" має збігатися з каноном пакета @nitra/cursor (npm/rules/js-lint/js/data/tooling/oxlint-canonical.json)`
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

/**
 * Перевіряє ESLint flat config файл.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkEslintConfig(passFn, failFn, cwd) {
  let eslintPath
  if (existsSync(join(cwd, 'eslint.config.js'))) {
    eslintPath = 'eslint.config.js'
    passFn('eslint.config.js існує')
  } else if (existsSync(join(cwd, 'eslint.config.mjs'))) {
    eslintPath = 'eslint.config.mjs'
    passFn('eslint.config.mjs існує')
  } else {
    failFn('Відсутній eslint.config.js або eslint.config.mjs — flat config з getConfig (js-lint.mdc)')
    return
  }
  const eslintRaw = await readFile(join(cwd, eslintPath), 'utf8')
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

// Перевірки `prettier` / `@nitra/prettier-config` у залежностях (text.mdc) і
// `@nitra/eslint-config ≥ 3.10.0` тепер у Rego: відповідно
// `npm/policy/text/package_json/` і `npm/policy/js_lint/package_json/`. Тут
// лишилася лише workspace-ітерація для `type: "module"` і engines, бо js_lint
// Rego запускається лише на кореневому `package.json`.

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
 * @param {string} cwd корінь репозиторію
 */
async function checkWorkspacePackages(workspaces, passFn, failFn, cwd) {
  for (const ws of workspaces) {
    const wsPkgRel = `${ws}/package.json`
    const wsPkgAbs = join(cwd, wsPkgRel)
    if (existsSync(wsPkgAbs)) {
      const wsPkg = JSON.parse(await readFile(wsPkgAbs, 'utf8'))
      checkPackageJsonTypeModule(wsPkgRel, wsPkg, passFn, failFn)
      checkEnginesNode(wsPkgRel, wsPkg, passFn, failFn)
      checkEnginesBun(wsPkgRel, wsPkg, passFn, failFn)
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
 * Workspace-ітерація: для кожного workspace `package.json` перевіряємо
 * `type: "module"` і `engines.{node,bun}`. Кореневий `package.json` ці поля
 * валідує `npm/policy/js_lint/package_json/`; lint-js скрипт і `@nitra/eslint-config`
 * — теж у Rego.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkPackageJsonJsLint(passFn, failFn, cwd) {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
  await checkWorkspacePackages(workspaces, passFn, failFn, cwd)
}

/**
 * Перевіряє .oxlintrc.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkOxlintRc(passFn, failFn, cwd) {
  const oxPath = join(cwd, '.oxlintrc.json')
  if (!existsSync(oxPath)) {
    failFn('.oxlintrc.json не існує — додай конфіг oxlint (js-lint.mdc)')
    return
  }
  let oxCfg
  try {
    oxCfg = JSON.parse(await readFile(oxPath, 'utf8'))
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
 * FS-existence для `lint-js.yml` + cross-file перевірка, що `lint.yml` (якщо існує)
 * не дублює лінт JS-кроки. Структуру `lint-js.yml` (`actions/checkout@v6`,
 * `persist-credentials: false`, `setup-bun-deps`, `bunx oxlint/eslint/jscpd .`,
 * заборона `--fix` у CI) валідує `npm/policy/js_lint/lint_js_yml/`.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkLintJsWorkflows(passFn, failFn, cwd) {
  if (existsSync(join(cwd, '.github/workflows/lint-js.yml'))) {
    passFn('.github/workflows/lint-js.yml є (структуру перевіряє npx @nitra/cursor fix → js_lint.lint_js_yml)')
  } else {
    failFn('.github/workflows/lint-js.yml не існує — створи його (див. rules/js-lint/check.mjs / js-lint.mdc)')
  }

  const lintYmlPath = join(cwd, '.github/workflows/lint.yml')
  if (existsSync(lintYmlPath)) {
    const lintYml = await readFile(lintYmlPath, 'utf8')
    if (lintYml.includes('bunx oxlint') && lintYml.includes('bunx eslint') && lintYml.includes('jscpd')) {
      failFn('.github/workflows/lint.yml дублює кроки lint-js.yml — залиш один workflow на лінт JS (js-lint.mdc)')
    } else {
      passFn('.github/workflows/lint.yml не дублює oxlint/eslint/jscpd з lint-js.yml')
    }
  }
}

/**
 * Перевіряє наявність `knip.json` у корені проєкту. Якщо файл відсутній —
 * копіює канонічний `knip-canonical.json` з пакета `@nitra/cursor` як стартовий
 * baseline; зміст подальших модифікацій локально не валідується (`entry` /
 * `project` / `ignore` / `ignoreDependencies` / `ignoreBinaries` дозволені
 * будь-які; це side effect — описано у js-lint.mdc).
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkKnipConfig(passFn, failFn, cwd) {
  const knipPath = join(cwd, 'knip.json')
  if (existsSync(knipPath)) {
    passFn('knip.json існує')
    return
  }
  if (!existsSync(KNIP_CANONICAL_JSON_PATH)) {
    failFn(
      `knip.json відсутній, і канонічний шаблон у пакеті не знайдено (${KNIP_CANONICAL_JSON_PATH}) — ` +
        'перевстанови @nitra/cursor'
    )
    return
  }
  await copyFile(KNIP_CANONICAL_JSON_PATH, knipPath)
  passFn('knip.json створено з канонічного npm/rules/js-lint/js/data/tooling/knip-canonical.json (js-lint.mdc)')
}

/**
 * Перевіряє відповідність проєкту правилам js-lint.mdc
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkEslintConfig(pass, fail, cwd)
  await checkPackageJsonJsLint(pass, fail, cwd)
  await checkOxlintRc(pass, fail, cwd)
  await checkLintJsWorkflows(pass, fail, cwd)
  await checkKnipConfig(pass, fail, cwd)

  for (const dup of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']) {
    if (existsSync(join(cwd, dup))) fail(`Знайдено застарілий конфіг ESLint: ${dup} — видали, використовуй flat config`)
  }

  return reporter.getExitCode()
}
