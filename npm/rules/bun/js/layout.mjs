/**
 * Перевіряє відповідність репозиторію правилам Bun (bun.mdc).
 *
 * **Що тут лишилося** (FS / cross-file — не покривається conftest):
 *  - наявність `bun.lock`, `bunfig.toml`, `package.json` у корені (FS-existence);
 *  - заборонені lockfile та артефакти yarn/pnpm (`package-lock.json`, `yarn.lock`,
 *    `pnpm-lock.yaml`, `.yarnrc.yml`, директорія `.yarn/`);
 *  - двосторонній зв'язок `.n-cursor.json:rules` ↔ `package.json:scripts` для правил із
 *    `lint-<id>` (`docker`, `k8s`): rule увімкнено → скрипт мусить існувати; rule
 *    відсутнє (або в `disable-rules`) → скрипту та згадки `bun run lint-<id>` у
 *    агрегованому `scripts.lint` бути **не може** (інакше `bun run lint` падатиме
 *    на правилі, яке у конфізі вимкнено).
 *
 * **Що покрила Rego** (`npx \@nitra/cursor check`):
 *  - `npm/policy/bun/bunfig/` — `[install].linker == "hoisted"` у `bunfig.toml`;
 *  - `npm/policy/bun/package_json/` — відсутність `packageManager` / `dependencies`
 *    у кореневому `package.json`, у `devDependencies` лише `@nitra/*`, агрегований
 *    `lint`-скрипт покриває всі `lint-*` через `bun run` і завершується `&& oxfmt .`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Розділювач токенів у `scripts.lint` (послідовність пробільних символів). */
const WHITESPACE_RE = /\s+/u

// Перевірка `devDependencies` кореневого `package.json` (дозволено лише `@nitra/*`)
// — у rego (`npm/policy/bun/package_json/`). JS-копії `isAllowedRootDevDependency`
// видалено, щоб не було двох джерел істини.

/**
 * Зчитує `rules` та `disable-rules` з `.n-cursor.json`.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<{ rules: Set<string>, disabled: Set<string> }>} активні правила і явно вимкнені
 */
async function loadNCursorRules(cwd) {
  const empty = { rules: new Set(), disabled: new Set() }
  const cfgPath = join(cwd, '.n-cursor.json')
  if (!existsSync(cfgPath)) return empty
  try {
    const raw = JSON.parse(await readFile(cfgPath, 'utf8'))
    const list = Array.isArray(raw?.rules) ? raw.rules.map(String) : []
    const disabled = Array.isArray(raw?.['disable-rules']) ? raw['disable-rules'].map(String) : []
    return { rules: new Set(list), disabled: new Set(disabled) }
  } catch {
    return empty
  }
}

/**
 * Чи містить `scripts.lint` виклик `bun run <script>` у chain'і. Шукаємо саме `bun run <script>`
 * як окремий токен (між пробілами/`&&`), щоб уникнути false-positive на префіксах
 * (`bun run lint-k8s-foo` не матчиться як `bun run lint-k8s`).
 * @param {string} lintScript значення `scripts.lint` (порожній рядок — якщо нема)
 * @param {string} target ім'я скрипта (без префіксів)
 * @returns {boolean} true, якщо chain згадує `bun run <target>`
 */
function lintChainHasScript(lintScript, target) {
  if (!lintScript) return false
  const tokens = lintScript.split(WHITESPACE_RE)
  return tokens.some((tok, i) => tok === 'bun' && tokens[i + 1] === 'run' && tokens[i + 2] === target)
}

/**
 * Описує `lint-<id>`-обгортку та правила, що нею володіють. Один скрипт може мати кілька
 * власників (`lint-image` — обслуговує і `image-avif`, і `image-compress`); скрипт вважається
 * «потрібним», якщо **хоч одне** з власних правил активне у `.n-cursor.json:rules`.
 * @typedef {object} RuleScript
 * @property {string[]} rules id правил-власників (>=1); скрипт зобов'язаний існувати, поки активне хоч одне з них
 * @property {string} script ім'я скрипта в `package.json:scripts`
 * @property {string} doc `.mdc`-файл (або кома-список), на який посилається повідомлення check-у
 */

/** @type {RuleScript[]} */
const RULE_SCRIPTS = [
  { rules: ['docker'], script: 'lint-docker', doc: 'docker.mdc' },
  { rules: ['k8s'], script: 'lint-k8s', doc: 'k8s.mdc' },
  { rules: ['image-avif', 'image-compress'], script: 'lint-image', doc: 'image-avif.mdc / image-compress.mdc' }
]

/**
 * Загортає кожен ідентифікатор у backticks та зʼєднує через роздільник. Винесено
 * окремою функцією, щоб не нестити template literals у `pass`/`fail`-повідомленнях.
 * @param {string[]} items ідентифікатори правил
 * @param {string} sep роздільник (наприклад `, ` або `/`)
 * @returns {string} рядок виду "`a`, `b`"
 */
function backtickJoin(items, sep) {
  return items.map(r => '`' + r + '`').join(sep)
}

/**
 * Описує стан правил-власників скрипта для повідомлень про reason. Повертає або список увімкнених
 * правил (для passing-кейсу «правило є»), або компактний опис, чому всі вимкнені (для inverse-fail).
 * @param {string[]} owners id правил-власників (>=1)
 * @param {{ rules: Set<string>, disabled: Set<string> }} cursorRules `rules` та `disable-rules`
 * @returns {{ enabled: string[], reason: string }} `enabled` — список з `cursorRules.rules`; `reason` — текст для лога
 */
function ownerStatus(owners, cursorRules) {
  const enabled = owners.filter(r => cursorRules.rules.has(r))
  if (enabled.length > 0) {
    return { enabled, reason: `правил${enabled.length === 1 ? 'о' : 'а'} ${backtickJoin(enabled, ', ')}` }
  }
  if (owners.length === 1) {
    const [only] = owners
    const where = cursorRules.disabled.has(only) ? 'в disable-rules' : 'відсутнє в rules'
    return { enabled, reason: `правило \`${only}\` ${where}` }
  }
  const disabledCount = owners.filter(r => cursorRules.disabled.has(r)).length
  const note = disabledCount === owners.length ? 'усі власники в disable-rules' : 'жоден власник не активний у rules'
  return { enabled, reason: `${backtickJoin(owners, '/')} — ${note}` }
}

/**
 * Перевіряє двосторонній зв'язок `rules` ↔ `scripts.lint-<id>` для правил із `lint-<id>`-обгорткою
 * (див. `RULE_SCRIPTS`). Якщо активне хоч одне правило-власник — скрипт мусить існувати; якщо
 * жодне з власників не активне (відсутнє у `rules` або є в `disable-rules`), скрипту і згадки
 * `bun run <script>` у `scripts.lint` бути **не може**. Інакше `bun run lint` падатиме на
 * вимкненому правилі: `n-cursor lint-<id>` ігнорує `.n-cursor.json` і обходить дерево
 * незалежно від конфігу (як було в cursor-репо: `disable-rules: ["k8s"]` + залишений `lint-k8s`
 * ламав chain на template-сорцях власного правила).
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter callback-и `pass`/`fail` для звіту
 * @param {Record<string, string>} scripts scripts з package.json
 * @param {{ rules: Set<string>, disabled: Set<string> }} cursorRules `rules` та `disable-rules`
 */
function checkCursorRuleScripts(reporter, scripts, cursorRules) {
  const { pass, fail } = reporter
  const lintScript = typeof scripts.lint === 'string' ? scripts.lint : ''
  for (const { rules: owners, script, doc } of RULE_SCRIPTS) {
    const status = ownerStatus(owners, cursorRules)
    const present = Boolean(scripts[script])
    const inChain = lintChainHasScript(lintScript, script)
    if (status.enabled.length > 0) {
      if (present) {
        pass(`package.json: є \`${script}\` (${status.reason} у .n-cursor.json)`)
      } else {
        fail(
          `У .n-cursor.json увімкнено ${status.reason} — додай скрипт \`${script}\` у кореневий package.json (див. ${doc})`
        )
      }
      continue
    }
    if (present) {
      fail(
        `У .n-cursor.json немає активних власників ${backtickJoin(owners, '/')} — прибери скрипт \`${script}\` з кореневого package.json (див. ${doc})`
      )
    }
    if (inChain) {
      fail(
        `У \`scripts.lint\` є \`bun run ${script}\`, але серед \`${owners.join('/')}\` жоден не активний у .n-cursor.json — прибери з ланцюжка lint (див. ${doc})`
      )
    }
    if (!present && !inChain) {
      pass(`package.json: \`${script}\` відсутній (${status.reason})`)
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам bun.mdc
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']) {
    if (existsSync(join(cwd, f))) {
      fail(`Знайдено заборонений файл: ${f} — видали його`)
    } else {
      pass(`Немає ${f}`)
    }
  }

  if (existsSync(join(cwd, '.yarn'))) {
    fail('Знайдено директорію .yarn — видали її')
  } else {
    pass('Немає .yarn/')
  }
  if (existsSync(join(cwd, 'bun.lock'))) {
    pass('bun.lock є')
  } else {
    fail('Відсутній bun.lock — запусти bun i')
  }

  if (existsSync(join(cwd, 'bunfig.toml'))) {
    pass('bunfig.toml є (структуру перевіряє npx @nitra/cursor fix → bun.bunfig)')
  } else {
    fail('Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)')
  }

  const cursorRules = await loadNCursorRules(cwd)

  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    fail('Відсутній package.json у корені')
    return reporter.getExitCode()
  }

  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  checkCursorRuleScripts(reporter, scripts, cursorRules)

  return reporter.getExitCode()
}
