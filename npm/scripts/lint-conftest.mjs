/**
 * Прогоняє `conftest test` по всіх Rego-полісі з `npm/rules/<rule>/policy/<concern>/`.
 *
 * Джерело правди — `target.json` поруч із кожним `<concern>.rego`. Маніфест декларує,
 * які файли проєкту фідити в conftest (`files.single` або `files.walkGlob`). Resolver
 * і walk-кеш — спільні з CLI `check` (`scripts/utils/resolve-target-files.mjs`),
 * discovery — `scripts/utils/discover-checkable-rules.mjs`.
 *
 * Фільтрація за `.n-cursor.json:rules` — не перевіряємо полісі правил, які проєкт
 * не активує (як було у попередній hardcoded TARGETS-таблиці).
 *
 * Поведінка fallback:
 *  - якщо `conftest` не в PATH — `ℹ` install-hint, повертаємо 0 (структурні JS-перевірки
 *    в `check-*.mjs` лишаються паралельно). Те саме рішення — у `rules/ga/js/lint.mjs`.
 *  - якщо `rules/` каталог відсутній (нетипова інсталяція) — також `ℹ` skip.
 *
 * Перший ненульовий exit-код conftest — повертаємо як результат, але всі наступні цілі
 * все одно виконуємо, щоб одразу побачити повний список порушень.
 *
 * Експортовано `runLintConftestCli` — використовується з `bin/n-cursor.js` як підкоманда
 * `lint-conftest`, а також виконується напряму через `bun ./npm/scripts/lint-conftest.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discoverCheckableRules } from './utils/discover-checkable-rules.mjs'
import { resolveCmd } from './utils/resolve-cmd.mjs'
import { resolveTargetFiles } from './utils/resolve-target-files.mjs'

/** Каталог пакету `@nitra/cursor`, від якого ресолвимо вшиті директорії правил. */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Шлях до кореня правил. У npm-tarball публікується через `files: ["rules"]`. */
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Зчитує `rules` з `.n-cursor.json` у cwd. Повертає множину рядків — або `null`,
 * якщо файлу немає чи поле некоректне (тоді гейтинг вимикаємо — як було в попередній версії).
 * @param {string} cwd корінь репо
 * @returns {Set<string> | null} множина активних правил або null
 */
function loadActiveCursorRules(cwd) {
  const path = join(cwd, '.n-cursor.json')
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw?.rules)) return null
    return new Set(raw.rules.map(String))
  } catch {
    return null
  }
}

/**
 * Обчислює namespace rego-полісі за id правила і ім'ям концерну.
 * Rego не дозволяє '-' в імені пакета, тож kebab-id у `.n-cursor.json:rules`
 * мапиться на snake у namespace; ім'я концерну йде як є (вже snake у `policy/<concern>/`).
 * @param {string} ruleId id правила (kebab)
 * @param {string} concernName ім'я concern (підкаталог у `policy/`)
 * @returns {string} namespace для `conftest --namespace`
 */
function computeNamespace(ruleId, concernName) {
  return `${ruleId.replaceAll('-', '_')}.${concernName}`
}

/**
 * Запускає conftest на одному policy-концерні. Повертає exit-код (0 — OK, 1+ — порушення).
 *
 * stdio: 'inherit' — щоб користувач бачив рідну форматовану табличку conftest у виводі
 * `bun run lint` (відрізняється від структурованого JSON-варіанта в `check`-команді).
 * @param {string} conftestBin абсолютний шлях до бінарника conftest
 * @param {string} ruleId id правила
 * @param {string} concernName ім'я concern
 * @param {string} namespace rego-пакет
 * @param {string[]} files список файлів (відносні/абсолютні шляхи)
 * @returns {number} exit-код
 */
function runConftestForConcern(conftestBin, ruleId, concernName, namespace, files) {
  const policyAbs = join(RULES_DIR, ruleId, 'policy', concernName)
  if (!existsSync(policyAbs)) {
    return 0
  }
  console.log(`\n▶ conftest (${namespace} — ${files.length} файл(ів))`)
  const r = spawnSync(conftestBin, ['test', ...files, '-p', policyAbs, '--namespace', namespace, '--no-color'], {
    stdio: 'inherit',
    env: process.env
  })
  if (r.error) {
    console.error(`❌ Не вдалося запустити conftest: ${r.error.message}`)
    return 1
  }
  return r.status ?? 1
}

/**
 * Запускає `conftest test` по всіх policy-концернах із `target.json`-маніфестів.
 * Фільтрація — за `activeRules` (поле `rules` у `.n-cursor.json`). Перший ненульовий
 * exit-код запамʼятовується, але цикл йде до кінця.
 *
 * Якщо `conftest` не знайдено в PATH — друкує `ℹ` повідомлення і повертає 0.
 * @returns {Promise<number>} 0 — все OK або skip; інакше — перший ненульовий exit-код
 */
export async function runLintConftestCli() {
  const conftestBin = resolveCmd('conftest')
  if (!conftestBin) {
    console.log(
      'ℹ conftest не знайдено в PATH — пропускаю Rego-перевірки.\n' +
        '  Встанови, щоб запустити локально: brew install conftest (macOS) або https://www.conftest.dev/install/'
    )
    return 0
  }
  if (!existsSync(RULES_DIR)) {
    console.log(`ℹ Каталог правил не знайдено (${RULES_DIR}) — пропускаю conftest.`)
    return 0
  }

  const cwd = process.cwd()
  const activeRules = loadActiveCursorRules(cwd)
  const rules = await discoverCheckableRules(RULES_DIR)
  /** @type {Map<string, Promise<string[]>>} */
  const walkCache = new Map()
  let firstFailureCode = 0

  for (const rule of rules) {
    if (activeRules && !activeRules.has(rule.id)) continue
    for (const concern of rule.policyConcerns) {
      const targetPath = join(RULES_DIR, rule.id, 'policy', concern.name, 'target.json')
      /** @type {{ files: { single?: string, walkGlob?: string|string[], required?: boolean }, missingMessage?: string }} */
      const target = JSON.parse(await readFile(targetPath, 'utf8'))
      const files = await resolveTargetFiles(target.files, cwd, walkCache)
      if (files.length === 0) continue
      const namespace = computeNamespace(rule.id, concern.name)
      const code = runConftestForConcern(conftestBin, rule.id, concern.name, namespace, files)
      if (code !== 0 && firstFailureCode === 0) {
        firstFailureCode = code
      }
    }
  }
  return firstFailureCode
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = (await runLintConftestCli()) ?? 0
}
