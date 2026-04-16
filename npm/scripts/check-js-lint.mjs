/**
 * Перевіряє лінт JavaScript за правилом js-lint.mdc.
 *
 * Канонічний `lint-js`, flat ESLint з getConfig і ignore для auto-imports, рекомендації VSCode,
 * `.oxlintrc.json` з `jsPlugins` (`@e18e/eslint-plugin`) і правилом `e18e/prefer-includes: error`,
 * `@nitra/eslint-config` у devDependencies мінімум **3.5.0** (транзитивний `@e18e/eslint-plugin` для oxlint), `.jscpd.json`
 * (gitignore, exitCode, reporters, minLines), workflow `lint-js.yml` (checkout@v6, setup-bun-deps,
 * bunx без --fix), без prettier, `engines.node` >= 24. Дубль перевірки JS у `lint.yml` — заборонено.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { parseWorkflowYaml, verifyLintJsWorkflowStructure } from './utils/gha-workflow.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'

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
 * Чи діапазон `@nitra/eslint-config` у `package.json` передбачає версію з транзитивним `@e18e/eslint-plugin` (>=3.5.0).
 * @param {unknown} versionSpec значення `devDependencies['@nitra/eslint-config']`
 * @returns {boolean} true для `workspace:*` або першої semver у рядку >= 3.5.0
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
 * Перевіряє потрібні поля `.oxlintrc.json` для розширення e18e (js-lint.mdc).
 * @param {unknown} cfg корінь JSON-конфігурації oxlint
 * @returns {{ ok: boolean, failures: string[] }} `ok` і перелік повідомлень для `fail`
 */
export function verifyOxlintRcE18e(cfg) {
  const failures = []
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, failures: ['.oxlintrc.json: корінь має бути значенням типу object'] }
  }
  const o = /** @type {Record<string, unknown>} */ (cfg)
  const jsPlugins = o.jsPlugins
  if (!Array.isArray(jsPlugins) || !jsPlugins.includes('@e18e/eslint-plugin')) {
    failures.push('.oxlintrc.json: jsPlugins має містити "@e18e/eslint-plugin"')
  }
  const rules = o.rules
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    failures.push('.oxlintrc.json: поле rules має бути значенням типу object')
  } else {
    const r = /** @type {Record<string, unknown>} */ (rules)
    if (r['e18e/prefer-includes'] !== 'error') {
      failures.push('.oxlintrc.json: у rules має бути "e18e/prefer-includes": "error"')
    }
  }
  return { ok: failures.length === 0, failures }
}

/**
 * Перевіряє відповідність проєкту правилам js-lint.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  let eslintPath = ''
  if (existsSync('eslint.config.js')) {
    eslintPath = 'eslint.config.js'
    pass('eslint.config.js існує')
  } else if (existsSync('eslint.config.mjs')) {
    eslintPath = 'eslint.config.mjs'
    pass('eslint.config.mjs існує')
  } else {
    fail('Відсутній eslint.config.js або eslint.config.mjs — flat config з getConfig (js-lint.mdc)')
  }

  if (eslintPath) {
    const eslintRaw = await readFile(eslintPath, 'utf8')
    if (eslintRaw.includes('getConfig')) {
      pass(`${eslintPath}: містить getConfig`)
    } else {
      fail(`${eslintPath}: потрібен виклик getConfig (js-lint.mdc)`)
    }
    if (eslintRaw.includes('@nitra/eslint-config')) {
      pass(`${eslintPath}: імпорт @nitra/eslint-config`)
    } else {
      fail(`${eslintPath}: імпортуй getConfig з @nitra/eslint-config`)
    }
    if (eslintRaw.includes('**/auto-imports.d.ts')) {
      pass(`${eslintPath}: ignores містить **/auto-imports.d.ts`)
    } else {
      fail(`${eslintPath}: додай у ignores запис **/auto-imports.d.ts (js-lint.mdc)`)
    }
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))

    if (pkg.scripts?.['lint-js']) {
      pass('package.json містить скрипт lint-js')
      const lintJs = String(pkg.scripts['lint-js'])
      if (isCanonicalLintJs(lintJs)) {
        pass(`lint-js збігається з каноном: ${CANONICAL_LINT_JS}`)
      } else {
        fail(
          `lint-js має бути рівно: "${CANONICAL_LINT_JS}" (див. js-lint.mdc / check-js-lint.mjs). Зараз: ${JSON.stringify(normalizeLintJsScript(lintJs))}`
        )
      }
    } else {
      fail(`package.json не містить скрипт "lint-js" — додай: ${JSON.stringify(CANONICAL_LINT_JS)}`)
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (allDeps.prettier) {
      fail('package.json: видали залежність prettier (oxfmt замість prettier, js-lint.mdc)')
    } else {
      pass('package.json не містить prettier')
    }
    if (allDeps['@nitra/prettier-config']) {
      fail('package.json: видали @nitra/prettier-config (js-lint.mdc)')
    } else {
      pass('package.json не містить @nitra/prettier-config')
    }

    const nitraEslint = pkg.devDependencies?.['@nitra/eslint-config']
    if (nitraEslint) {
      pass('@nitra/eslint-config є в devDependencies')
      if (nitraEslintConfigDeclaresE18eTransitive(nitraEslint)) {
        pass('@nitra/eslint-config: мінімум 3.5.0 (транзитивний @e18e/eslint-plugin для oxlint jsPlugins, js-lint.mdc)')
      } else {
        fail(
          '@nitra/eslint-config: онови до мінімум "^3.5.0" — з цієї версії постачається @e18e/eslint-plugin для .oxlintrc.json (js-lint.mdc)'
        )
      }
    } else {
      fail('@nitra/eslint-config відсутній в devDependencies — додай: bun add -d @nitra/eslint-config')
    }

    const nodeEngine = pkg.engines?.node
    if (nodeEngine) {
      const firstNumeric = String(nodeEngine).split(NON_DIGITS_RE).find(Boolean)
      if (firstNumeric && Number(firstNumeric) >= 24) {
        pass(`engines.node: "${nodeEngine}"`)
      } else {
        fail(`engines.node: "${nodeEngine}" — має бути >=24`)
      }
    } else {
      fail('package.json не містить engines.node — додай: "engines": { "node": ">=24" }')
    }
  }

  if (existsSync('.oxlintrc.json')) {
    let oxCfg
    try {
      oxCfg = JSON.parse(await readFile('.oxlintrc.json', 'utf8'))
    } catch {
      fail('.oxlintrc.json не є валідним JSON')
      oxCfg = null
    }
    if (oxCfg !== null) {
      pass('.oxlintrc.json існує')
      const oxV = verifyOxlintRcE18e(oxCfg)
      if (oxV.ok) {
        pass('.oxlintrc.json: jsPlugins з @e18e/eslint-plugin і e18e/prefer-includes: error')
      } else {
        for (const msg of oxV.failures) {
          fail(msg)
        }
      }
    }
  } else {
    fail('.oxlintrc.json не існує — додай конфіг oxlint (js-lint.mdc)')
  }

  if (existsSync('.vscode/extensions.json')) {
    let ext
    try {
      ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    } catch {
      fail('.vscode/extensions.json не є валідним JSON')
      ext = null
    }
    if (ext) {
      const rec = ext.recommendations
      if (Array.isArray(rec)) {
        const missing = REQUIRED_VSCODE_EXTENSIONS.filter(id => !rec.includes(id))
        if (missing.length > 0) {
          fail(`.vscode/extensions.json: додай у recommendations: ${missing.join(', ')} (мінімум для js-lint.mdc)`)
        } else {
          pass('.vscode/extensions.json: є рекомендації oxlint, eslint і GitHub Actions')
        }
      } else {
        fail('.vscode/extensions.json: поле recommendations має бути масивом')
      }
    }
  } else {
    fail('.vscode/extensions.json не існує — додай recommendations з js-lint.mdc (див. check-js-lint.mjs)')
  }

  if (existsSync('.github/workflows/lint-js.yml')) {
    const content = await readFile('.github/workflows/lint-js.yml', 'utf8')
    pass('lint-js.yml існує')
    const root = parseWorkflowYaml(content)
    if (root) {
      const v = verifyLintJsWorkflowStructure(root)
      if (v.ok) {
        pass('lint-js.yml: кроки checkout, setup-bun-deps, oxlint/eslint/jscpd (YAML + кроки)')
      } else {
        for (const msg of v.failures) {
          fail(`lint-js.yml: ${msg}`)
        }
      }
    } else {
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
          pass(`lint-js.yml містить: ${needle}`)
        } else {
          fail(errMsg)
        }
      }
      if (content.includes('bunx oxlint') && OXLINT_FIX_RE.test(content)) {
        fail('lint-js.yml: у CI не використовуй bunx oxlint --fix (лише bunx oxlint)')
      }
      if (content.includes('eslint --fix')) {
        fail('lint-js.yml: у CI не використовуй eslint --fix (лише bunx eslint .)')
      }
    }
  } else {
    fail('.github/workflows/lint-js.yml не існує — створи його (див. check-js-lint.mjs / js-lint.mdc)')
  }

  if (existsSync('.github/workflows/lint.yml')) {
    const lintYml = await readFile('.github/workflows/lint.yml', 'utf8')
    const looksLikeJsLint = lintYml.includes('bunx oxlint') && lintYml.includes('bunx eslint') && lintYml.includes('jscpd')
    if (looksLikeJsLint) {
      fail('.github/workflows/lint.yml дублює кроки lint-js.yml — залиш один workflow на лінт JS (js-lint.mdc)')
    } else {
      pass('.github/workflows/lint.yml не дублює oxlint/eslint/jscpd з lint-js.yml')
    }
  }

  if (existsSync('.jscpd.json')) {
    let jscpdCfg
    try {
      jscpdCfg = JSON.parse(await readFile('.jscpd.json', 'utf8'))
    } catch {
      fail('.jscpd.json не є валідним JSON')
      jscpdCfg = null
    }
    if (jscpdCfg) {
      pass('.jscpd.json існує')
      if (jscpdCfg.gitignore === true) {
        pass('.jscpd.json: gitignore увімкнено')
      } else {
        fail('.jscpd.json має містити "gitignore": true')
      }
      if (jscpdCfg.exitCode === 1) {
        pass('.jscpd.json: exitCode 1 при дублікатах')
      } else {
        fail('.jscpd.json має містити "exitCode": 1 (інакше CI не впаде на клонах)')
      }
      const reporters = jscpdCfg.reporters
      if (Array.isArray(reporters) && reporters.includes('console')) {
        pass('.jscpd.json: reporters містить console')
      } else {
        fail('.jscpd.json має містити "reporters": ["console"] (або масив із "console")')
      }
      const minLines = jscpdCfg.minLines
      if (typeof minLines === 'number' && minLines >= 25) {
        pass(`.jscpd.json: minLines ${minLines} (>=25)`)
      } else {
        fail('.jscpd.json має містити "minLines" як число >= 25')
      }
    }
  } else {
    fail('.jscpd.json не існує — створи з полями згідно check js-lint')
  }

  for (const dup of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']) {
    if (existsSync(dup)) fail(`Знайдено застарілий конфіг ESLint: ${dup} — видали, використовуй flat config`)
  }

  return reporter.getExitCode()
}
