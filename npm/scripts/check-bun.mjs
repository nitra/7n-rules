/**
 * Перевіряє відповідність репозиторію правилам Bun (bun.mdc).
 *
 * Очікує наявність `bun.lock`, `bunfig.toml` з `linker = "hoisted"` у секції `[install]`,
 * забороняє lockfile та артефакти yarn/pnpm, директорію `.yarn` і поле `packageManager`
 * у кореневому `package.json`.
 *
 * У кореневому `package.json` не має бути поля **`dependencies`**; у **`devDependencies`** дозволені лише
 * пакети **`@nitra/*`** (наприклад **`@nitra/cspell-dict`**, **`@nitra/eslint-config`**).
 *
 * Якщо в `.n-cursor.json` у `rules` є `docker` або `k8s`, вимагає у кореневому `package.json`
 * відповідно скриптів `lint-docker` / `lint-k8s` (див. docker.mdc, k8s.mdc).
 *
 * Якщо в кореневому `package.json` є скрипти з префіксом `lint-`, перевіряє наявність агрегованого
 * скрипта `lint`, у якому через `bun run <ім’я>` викликаються всі такі скрипти, і що рядок `lint`
 * закінчується на `&& oxfmt .`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'

const OXFMT_END_RE = /&&[ \t]+oxfmt[ \t]+\.[ \t]*$/
const HOISTED_LINKER_RE = /^\s*linker\s*=\s*"hoisted"\s*$/m
const INSTALL_SECTION_RE = /^\s*\[install\]\s*$/m

/**
 * Перевіряє `bunfig.toml` на секцію `[install]` з `linker = "hoisted"`.
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер
 */
async function checkBunfigHoisted(reporter) {
  const { pass, fail } = reporter
  if (!existsSync('bunfig.toml')) {
    fail('Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)')
    return
  }
  const content = await readFile('bunfig.toml', 'utf8')
  if (!INSTALL_SECTION_RE.test(content)) {
    fail('bunfig.toml: відсутня секція [install] (bun.mdc)')
    return
  }
  if (HOISTED_LINKER_RE.test(content)) {
    pass('bunfig.toml: [install] linker = "hoisted"')
  } else {
    fail('bunfig.toml: у секції [install] має бути linker = "hoisted" (bun.mdc)')
  }
}

/**
 * Чи ім'я пакета дозволене в кореневих `devDependencies` за bun.mdc (лише **`@nitra/*`**).
 * @param {string} name ключ з поля `devDependencies`
 * @returns {boolean} true, якщо префікс дозволений
 */
export function isAllowedRootDevDependency(name) {
  return name.startsWith('@nitra/')
}

/**
 * Зчитує ідентифікатори правил з `.n-cursor.json` (поле `rules`).
 * @returns {Promise<Set<string>>} множина рядків id правил або порожня, якщо файлу/поля немає
 */
async function loadNCursorRules() {
  if (!existsSync('.n-cursor.json')) {
    return new Set()
  }
  try {
    const raw = JSON.parse(await readFile('.n-cursor.json', 'utf8'))
    const list = raw?.rules
    if (!Array.isArray(list)) {
      return new Set()
    }
    return new Set(list.map(String))
  } catch {
    return new Set()
  }
}

/**
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер для збору результатів
 * @param {Record<string, unknown>} pkg розібраний package.json
 */
function checkDevDependencies(reporter, pkg) {
  const { pass, fail } = reporter
  const dev = pkg.devDependencies
  if (dev === undefined) {
    pass('Кореневий package.json без devDependencies')
    return
  }
  if (dev === null || typeof dev !== 'object' || Array.isArray(dev)) {
    fail(
      'Кореневий package.json: `devDependencies` має бути object з ключами пакетів і діапазонами версій (не null, не масив)'
    )
    return
  }
  const bad = Object.keys(/** @type {object} */ (dev)).filter(n => !isAllowedRootDevDependency(n))
  if (bad.length > 0) {
    fail(`Кореневі devDependencies: дозволені лише @nitra/* — прибери або перенеси: ${bad.join(', ')} (bun.mdc)`)
    return
  }
  const n = Object.keys(/** @type {object} */ (dev)).length
  pass(
    n === 0
      ? 'Кореневі devDependencies порожні або відсутні (лише @nitra/*)'
      : `Кореневі devDependencies: лише @nitra/* (${n} пак.)`
  )
}

/**
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер для збору результатів
 * @param {Record<string, string>} scripts scripts з package.json
 */
function checkLintAggregate(reporter, scripts) {
  const { pass, fail } = reporter
  const lintPrefixed = Object.keys(scripts).filter(name => name.startsWith('lint-'))
  if (lintPrefixed.length === 0) return
  const aggregate = typeof scripts.lint === 'string' ? scripts.lint : ''
  if (!aggregate.trim()) {
    const scriptList = lintPrefixed.map(s => `\`${s}\``).join(', ')
    fail(
      `У package.json є скрипти ${scriptList}, але немає агрегованого \`lint\` — додай скрипт, який запускає їх через \`bun run\``
    )
    return
  }
  const missing = lintPrefixed.filter(name => !aggregate.includes(`bun run ${name}`))
  if (missing.length > 0) {
    const missingList = missing.map(s => '`' + s + '`').join(', ')
    fail(`Скрипт \`lint\` має викликати всі lint-* через bun run; відсутньо: ${missingList}`)
    return
  }
  pass('package.json: агрегований `lint` покриває всі `lint-*` скрипти')
  if (OXFMT_END_RE.test(aggregate.trim())) {
    pass('package.json: `lint` завершується `&& oxfmt .`')
  } else {
    fail('Скрипт `lint` має закінчуватися на `&& oxfmt .`')
  }
}

/**
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер для збору результатів
 * @param {Record<string, string>} scripts scripts з package.json
 * @param {Set<string>} cursorRules активні правила з .n-cursor.json
 */
function checkCursorRuleScripts(reporter, scripts, cursorRules) {
  const { pass, fail } = reporter
  /** @type {Array<{rule: string, script: string, doc: string}>} */
  const ruleScripts = [
    { rule: 'docker', script: 'lint-docker', doc: 'docker.mdc' },
    { rule: 'k8s', script: 'lint-k8s', doc: 'k8s.mdc' }
  ]
  for (const { rule, script, doc } of ruleScripts) {
    if (cursorRules.has(rule)) {
      if (scripts[script]) {
        pass(`package.json: є \`${script}\` (правило ${rule} у .n-cursor.json)`)
      } else {
        fail(
          `У .n-cursor.json є правило \`${rule}\` — додай скрипт \`${script}\` у кореневий package.json (див. ${doc})`
        )
      }
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам bun.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']) {
    if (existsSync(f)) {
      fail(`Знайдено заборонений файл: ${f} — видали його`)
    } else {
      pass(`Немає ${f}`)
    }
  }

  if (existsSync('.yarn')) {
    fail('Знайдено директорію .yarn — видали її')
  } else {
    pass('Немає .yarn/')
  }
  if (existsSync('bun.lock')) {
    pass('bun.lock є')
  } else {
    fail('Відсутній bun.lock — запусти bun i')
  }

  await checkBunfigHoisted(reporter)

  const cursorRules = await loadNCursorRules()

  if (!existsSync('package.json')) {
    return reporter.getExitCode()
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  if (pkg.packageManager) {
    fail(`package.json містить поле packageManager: "${pkg.packageManager}" — видали його`)
  } else {
    pass('package.json не містить packageManager')
  }

  if (pkg.dependencies === undefined) {
    pass('Кореневий package.json без поля `dependencies`')
  } else {
    fail(
      'Кореневий package.json не повинен містити поле `dependencies` — додай залежності в workspace-пакети (bun.mdc)'
    )
  }

  checkDevDependencies(reporter, pkg)

  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  checkCursorRuleScripts(reporter, scripts, cursorRules)
  checkLintAggregate(reporter, scripts)

  return reporter.getExitCode()
}
