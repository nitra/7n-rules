/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

import {
  KNIP_CANONICAL_JSON_PATH,
  OXLINT_CANONICAL_JSON_PATH,
  OXLINTRC_DRIFT,
  OXLINTRC_MISSING,
  verifyOxlintRcAgainstCanonical
} from '../tooling/main.mjs'

import {
  AUTO_IMPORTS_IGNORE,
  ESLINT_CONFIG_IGNORES,
  ESLINT_CONFIG_MISSING,
  ESLINT_CONFIG_VUE_WORKSPACE,
  detectWorkspaceTypes,
  parseVueList
} from './eslint-config.mjs'

const NON_DIGITS_RE = /\D+/u

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
    failFn('Відсутній eslint.config.js або eslint.config.mjs — flat config з getConfig (js.mdc)', ESLINT_CONFIG_MISSING)
    return
  }
  const eslintRaw = await readFile(join(cwd, eslintPath), 'utf8')
  const checks = [
    {
      needle: 'getConfig',
      ok: `${eslintPath}: містить getConfig`,
      err: `${eslintPath}: потрібен виклик getConfig (js.mdc)`
    },
    {
      needle: '@nitra/eslint-config',
      ok: `${eslintPath}: імпорт @nitra/eslint-config`,
      err: `${eslintPath}: імпортуй getConfig з @nitra/eslint-config`
    },
    {
      needle: AUTO_IMPORTS_IGNORE,
      ok: `${eslintPath}: ignores містить ${AUTO_IMPORTS_IGNORE}`,
      err: `${eslintPath}: додай у ignores запис ${AUTO_IMPORTS_IGNORE} (js.mdc)`,
      reason: ESLINT_CONFIG_IGNORES
    }
  ]
  for (const { needle, ok, err, reason } of checks) {
    if (eslintRaw.includes(needle)) {
      passFn(ok)
    } else {
      failFn(err, reason)
    }
  }
  await checkEslintWorkspaceTypes(eslintRaw, eslintPath, passFn, failFn, cwd)
}

/**
 * Кожен vue-воркспейс (детекція: `workspaces` root package.json + vue-залежність
 * або `.vue` файли) має бути у `vue: [...]` аргументах getConfig — інакше eslint
 * не підключає vue-parser і всі `.vue` файли воркспейсу не парсяться. Ловить
 * хибний scaffold типу `getConfig({ node: ['npm'] })` у vue-монорепо.
 * @param {string} eslintRaw вміст eslint.config
 * @param {string} eslintPath ім'я файлу конфігу для повідомлень
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string, reason?: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkEslintWorkspaceTypes(eslintRaw, eslintPath, passFn, failFn, cwd) {
  const types = await detectWorkspaceTypes(cwd)
  if (types.vue.length === 0) return
  const vueEntries = parseVueList(eslintRaw)
  for (const ws of types.vue) {
    if (vueEntries.includes(ws)) {
      passFn(`${eslintPath}: vue-воркспейс '${ws}' у vue: [...]`)
    } else {
      failFn(
        `${eslintPath}: воркспейс '${ws}' містить Vue-код, але відсутній у vue: [...] getConfig — ` +
          '.vue файли не парсяться (js.mdc)',
        ESLINT_CONFIG_VUE_WORKSPACE
      )
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
    failFn(`${label}: має містити "type": "module" (js.mdc)`)
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
    failFn('.oxlintrc.json не існує — додай конфіг oxlint (js.mdc)', OXLINTRC_MISSING)
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
    failFn('внутрішня помилка: не вдалося прочитати канон oxlint з пакета @7n/rules')
    return
  }
  const oxV = verifyOxlintRcAgainstCanonical(oxCfg, canonical)
  if (oxV.ok) {
    passFn('.oxlintrc.json збігається з каноном oxlint (@7n/rules)')
  } else {
    for (const msg of oxV.failures) {
      failFn(msg, OXLINTRC_DRIFT)
    }
  }
}

/**
 * Cross-file перевірка: `lint.yml` (якщо існує) не дублює лінт JS-кроки з `lint-js.yml`.
 * Existence і структуру `lint-js.yml` валідує mixin-концерн `js/lint_js_yml`
 * плагіна `@7n/rules-ci-github` (провайдер-специфіка — поза ядром).
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkLintJsWorkflows(passFn, failFn, cwd) {
  // Existence/структуру lint-js.yml вимагає провайдер-плагін @7n/rules-ci-github
  // (mixin js/lint_js_yml, policy required) — ядро провайдер-агностичне і тут
  // перевіряє лише крос-файловий дубляж, коли GitHub-workflow уже існують.
  const lintYmlPath = join(cwd, '.github/workflows/lint.yml')
  if (existsSync(lintYmlPath)) {
    const lintYml = await readFile(lintYmlPath, 'utf8')
    if (lintYml.includes('bunx oxlint') && lintYml.includes('bunx eslint') && lintYml.includes('jscpd')) {
      failFn('.github/workflows/lint.yml дублює кроки lint-js.yml — залиш один workflow на лінт JS (js.mdc)')
    } else {
      passFn('.github/workflows/lint.yml не дублює oxlint/eslint/jscpd з lint-js.yml')
    }
  }
}

/**
 * Перевіряє наявність `knip.json` у корені проєкту. Якщо файл відсутній —
 * копіює канонічний `knip-canonical.json` з пакета `@7n/rules` як стартовий
 * baseline; зміст подальших модифікацій локально не валідується (`entry` /
 * `project` / `ignore` / `ignoreDependencies` / `ignoreBinaries` дозволені
 * будь-які; це side effect — описано у js.mdc).
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
        'перевстанови @7n/rules'
    )
    return
  }
  await copyFile(KNIP_CANONICAL_JSON_PATH, knipPath)
  passFn('knip.json створено з канонічного npm/rules/js/tooling/data/tooling/knip-canonical.json (js.mdc)')
}

/**
 * Перевіряє відповідність проєкту правилам js.mdc
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  await checkEslintConfig(pass, fail, cwd)
  await checkPackageJsonJsLint(pass, fail, cwd)
  await checkOxlintRc(pass, fail, cwd)
  await checkLintJsWorkflows(pass, fail, cwd)
  await checkKnipConfig(pass, fail, cwd)

  for (const dup of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']) {
    if (existsSync(join(cwd, dup))) fail(`Знайдено застарілий конфіг ESLint: ${dup} — видали, використовуй flat config`)
  }

  return reporter.result()
}
