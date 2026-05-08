/**
 * Перевіряє вимоги правила adr.mdc: ADR Stop-hook capture-decisions.sh у Claude Code.
 *
 * Очікування:
 * - `.claude/hooks/capture-decisions.sh` існує і байт-у-байт збігається з канонічним
 *   `.claude-template/hooks/capture-decisions.sh` пакета (sync керує файлом повністю).
 * - `.claude/settings.json` (project-shared) має managed-групу у `hooks.Stop`, яка
 *   викликає цей bash-скрипт; маркер у `command` — `.claude/hooks/capture-decisions.sh`.
 * - `.claude/settings.local.json` (якщо існує) НЕ має дубля цієї managed-групи —
 *   після переходу на project-shared такий запис створив би два запуски на одну подію.
 * - `.gitignore` у корені містить шаблон, який покриває `.claude/hooks/capture-decisions.log`.
 *
 * LLM CLI (`claude` або `cursor-agent`) у `PATH` — інформативна перевірка: якщо жодного
 * немає, скрипт працює, але мовчки виходить, тому це warning, а не fail.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from './utils/check-reporter.mjs'

const PROJECT_HOOK_PATH = '.claude/hooks/capture-decisions.sh'
const PROJECT_SETTINGS_PATH = '.claude/settings.json'
const PROJECT_LOG_PATH = '.claude/hooks/capture-decisions.log'
const EOL_RE = /\r?\n/u

const here = dirname(fileURLToPath(import.meta.url))
/** Канонічний bundled-скрипт у пакеті — джерело правди для звірки з проєктним. */
const BUNDLED_HOOK_PATH = join(here, '..', '.claude-template', 'hooks', 'capture-decisions.sh')

/**
 * Чи містить рядок `.gitignore` шаблон, який покриває `.claude/hooks/capture-decisions.log`.
 * Враховує точний шлях, glob `.claude/hooks/*.log` та широкий glob `**\/*.log`.
 * @param {string} line одна нормалізована (trim) лінія `.gitignore`
 * @returns {boolean} `true`, якщо лінія матчить лог-файл хука
 */
function gitignoreLineCoversHookLog(line) {
  if (!line || line.startsWith('#')) {
    return false
  }
  if (line === PROJECT_LOG_PATH) {
    return true
  }
  if (line === '.claude/hooks/*.log' || line === '.claude/hooks/**/*.log') {
    return true
  }
  if (line === '*.log' || line === '**/*.log') {
    return true
  }
  return false
}

/**
 * Перевіряє наявність і канонічність `.claude/hooks/capture-decisions.sh` у проєкті.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @returns {Promise<void>}
 */
async function checkHookScript(reporter) {
  const { pass, fail } = reporter
  if (!existsSync(PROJECT_HOOK_PATH)) {
    fail(`${PROJECT_HOOK_PATH} не існує — запусти \`npx @nitra/cursor\` (правило adr копіює канонічний скрипт)`)
    return
  }
  if (!existsSync(BUNDLED_HOOK_PATH)) {
    fail(`канонічний скрипт у пакеті не знайдено: ${BUNDLED_HOOK_PATH} — перевстанови @nitra/cursor`)
    return
  }
  const [project, bundled] = await Promise.all([
    readFile(PROJECT_HOOK_PATH, 'utf8'),
    readFile(BUNDLED_HOOK_PATH, 'utf8')
  ])
  if (project === bundled) {
    pass(`${PROJECT_HOOK_PATH} збігається з канонічним`)
  } else {
    fail(`${PROJECT_HOOK_PATH} відрізняється від канонічного — запусти \`npx @nitra/cursor\` для повторного синку`)
  }
}

/**
 * FS-existence для project-shared `.claude/settings.json` і
 * `.claude/settings.local.json`. Структуру (`hooks.Stop[]` містить групу з
 * `capture-decisions.sh`; `settings.local.json` не дублює) валідують
 * `npm/policy/adr/settings_json/` і `npm/policy/adr/settings_local_json/`.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер
 */
function checkProjectSettings(reporter) {
  const { pass, fail } = reporter
  if (existsSync(PROJECT_SETTINGS_PATH)) {
    pass(`${PROJECT_SETTINGS_PATH} є (Stop-hook перевіряє bun run lint-conftest → adr.settings_json)`)
  } else {
    fail(`${PROJECT_SETTINGS_PATH} не існує — запусти \`npx @nitra/cursor\``)
  }
}

/**
 * Перевіряє `.gitignore` на ігнорування лог-файлу хука.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @returns {Promise<void>}
 */
async function checkGitignore(reporter) {
  const { pass, fail } = reporter
  if (!existsSync('.gitignore')) {
    fail(`.gitignore не існує — додай рядок \`${PROJECT_LOG_PATH}\``)
    return
  }
  const content = await readFile('.gitignore', 'utf8')
  const covers = content
    .split(EOL_RE)
    .map(l => l.trim())
    .some(line => gitignoreLineCoversHookLog(line))
  if (covers) {
    pass(`.gitignore покриває ${PROJECT_LOG_PATH}`)
  } else {
    fail(`.gitignore не ігнорує \`${PROJECT_LOG_PATH}\` — додай цей рядок`)
  }
}

/**
 * Чи виконуваний бінарник з іменем `name` доступний у `PATH` поточного процесу.
 * Перевірка без spawn — просто шукаємо файл у каталогах PATH (як `which`).
 * @param {string} name ім'я бінарника без розширення
 * @returns {boolean} `true`, якщо знайдено в одному з каталогів `PATH`
 */
function isBinaryInPath(name) {
  const path = env.PATH ?? ''
  if (!path) {
    return false
  }
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    if (existsSync(join(dir, name))) {
      return true
    }
  }
  return false
}

/**
 * Інформативна перевірка: чи доступний бодай один LLM CLI (`claude` або `cursor-agent`).
 * Якщо жодного немає — це warning (`pass` з підказкою), бо хук просто мовчки no-op'ає.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @returns {void}
 */
function checkLlmCliAvailable(reporter) {
  const { pass } = reporter
  const hasClaude = isBinaryInPath('claude')
  const hasCursor = isBinaryInPath('cursor-agent')
  if (hasClaude && hasCursor) {
    pass('LLM CLI: знайдено `claude` і `cursor-agent`')
  } else if (hasClaude) {
    pass('LLM CLI: знайдено `claude` (cursor-agent відсутній — fallback не використовується)')
  } else if (hasCursor) {
    pass('LLM CLI: знайдено `cursor-agent` (claude відсутній — буде використано fallback)')
  } else {
    pass(
      'LLM CLI: жодного з `claude`/`cursor-agent` не знайдено у PATH — Stop-hook буде мовчки no-op до встановлення CLI'
    )
  }
}

/**
 * Перевіряє відповідність проєкту правилам adr.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  await checkHookScript(reporter)
  checkProjectSettings(reporter)
  await checkGitignore(reporter)
  checkLlmCliAvailable(reporter)
  return reporter.getExitCode()
}
