/**
 * Перевіряє відповідність репозиторію правилам Bun (bun.mdc).
 *
 * **Що тут лишилося** (FS / cross-file — не покривається conftest):
 *  - наявність `bun.lock`, `bunfig.toml`, `package.json` у корені (FS-existence);
 *  - заборонені lockfile та артефакти yarn/pnpm (`package-lock.json`, `yarn.lock`,
 *    `pnpm-lock.yaml`, `.yarnrc.yml`, директорія `.yarn/`);
 *  - якщо в `.n-cursor.json` у `rules` є `docker` або `k8s`, у кореневому
 *    `package.json` має бути відповідний скрипт `lint-docker` / `lint-k8s`
 *    (cross-file: два JSON-файли).
 *
 * **Що покрила Rego** (`npx @nitra/cursor check`):
 *  - `npm/policy/bun/bunfig/` — `[install].linker == "hoisted"` у `bunfig.toml`;
 *  - `npm/policy/bun/package_json/` — відсутність `packageManager` / `dependencies`
 *    у кореневому `package.json`, у `devDependencies` лише `@nitra/*`, агрегований
 *    `lint`-скрипт покриває всі `lint-*` через `bun run` і завершується `&& oxfmt .`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

// Перевірка `devDependencies` кореневого `package.json` (дозволено лише `@nitra/*`)
// — у rego (`npm/policy/bun/package_json/`). JS-копії `isAllowedRootDevDependency`
// видалено, щоб не було двох джерел істини.

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

  if (existsSync('bunfig.toml')) {
    pass('bunfig.toml є (структуру перевіряє npx @nitra/cursor check → bun.bunfig)')
  } else {
    fail('Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)')
  }

  const cursorRules = await loadNCursorRules()

  if (!existsSync('package.json')) {
    fail('Відсутній package.json у корені')
    return reporter.getExitCode()
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  checkCursorRuleScripts(reporter, scripts, cursorRules)

  return reporter.getExitCode()
}
