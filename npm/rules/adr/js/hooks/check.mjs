/**
 * Перевіряє вимоги правила adr.mdc: ADR Stop-hook'и `capture-decisions.sh` і
 * `normalize-decisions.sh` у Claude Code.
 *
 * Очікування:
 * - `.claude/hooks/capture-decisions.sh` та `.claude/hooks/normalize-decisions.sh`
 *   існують і байт-у-байт збігаються з канонічними `.claude-template/hooks/*`
 *   пакета (sync керує файлами повністю).
 * - `.claude/settings.json` (project-shared) має managed-групи у `hooks.Stop` для
 *   обох скриптів (маркери у `command` — самі шляхи до скриптів).
 * - `.claude/settings.local.json` (якщо існує) НЕ має дублів цих managed-груп —
 *   після переходу на project-shared такі записи створили б два запуски на одну подію.
 * - `.gitignore` у корені містить шаблон, який покриває
 *   `.claude/hooks/capture-decisions.log` і `.claude/hooks/normalize-decisions.log`.
 *
 * LLM CLI (`claude` або `cursor-agent`) у `PATH` — інформативна перевірка: якщо жодного
 * немає, скрипт працює, але мовчки виходить, тому це warning, а не fail.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

/** Один hook-артефакт: bash-скрипт + його лог-файл, які перевіряємо однотипно. */
const HOOK_ARTIFACTS = /** @type {const} */ ([
  { scriptName: 'capture-decisions.sh', logName: 'capture-decisions.log' },
  { scriptName: 'normalize-decisions.sh', logName: 'normalize-decisions.log' }
])

const PROJECT_SETTINGS_PATH = '.claude/settings.json'
const EOL_RE = /\r?\n/u

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLED_HOOKS_DIR = join(here, '..', '..', '..', '..', '.claude-template', 'hooks')

/**
 * Відносний шлях до managed hook-скрипта у проєкті.
 * @param {string} scriptName базове ім'я скрипта (наприклад `capture-decisions.sh`)
 * @returns {string} `.claude/hooks/<scriptName>`
 */
function projectHookPath(scriptName) {
  return `.claude/hooks/${scriptName}`
}

/**
 * Відносний шлях до лог-файлу managed hook'а у проєкті.
 * @param {string} logName базове ім'я лог-файлу (наприклад `capture-decisions.log`)
 * @returns {string} `.claude/hooks/<logName>`
 */
function projectLogPath(logName) {
  return `.claude/hooks/${logName}`
}

/**
 * Чи містить рядок `.gitignore` шаблон, який покриває цей конкретний лог-файл хука.
 * Враховує точний шлях, glob `.claude/hooks/*.log` та широкий glob `**\/*.log`.
 * @param {string} line одна нормалізована (trim) лінія `.gitignore`
 * @param {string} logPath шлях `.claude/hooks/<name>.log`, який треба покрити
 * @returns {boolean} `true`, якщо лінія матчить цей лог-файл
 */
function gitignoreLineCoversHookLog(line, logPath) {
  if (!line || line.startsWith('#')) {
    return false
  }
  if (line === logPath) {
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
 * Перевіряє наявність і канонічність одного hook-скрипта.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @param {string} scriptName базове ім'я скрипта (наприклад `capture-decisions.sh`)
 * @returns {Promise<void>}
 */
async function checkHookScript(reporter, scriptName) {
  const { pass, fail } = reporter
  const projectPath = projectHookPath(scriptName)
  const bundledPath = join(BUNDLED_HOOKS_DIR, scriptName)
  if (!existsSync(projectPath)) {
    fail(`${projectPath} не існує — запусти \`npx @nitra/cursor\` (правило adr копіює канонічний скрипт)`)
    return
  }
  if (!existsSync(bundledPath)) {
    fail(`канонічний скрипт у пакеті не знайдено: ${bundledPath} — перевстанови @nitra/cursor`)
    return
  }
  const [project, bundled] = await Promise.all([readFile(projectPath, 'utf8'), readFile(bundledPath, 'utf8')])
  if (project === bundled) {
    pass(`${projectPath} збігається з канонічним`)
  } else {
    fail(`${projectPath} відрізняється від канонічного — запусти \`npx @nitra/cursor\` для повторного синку`)
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
 * Перевіряє `.gitignore` на ігнорування лог-файлу одного хука.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @param {string} logName базове ім'я лог-файлу (наприклад `capture-decisions.log`)
 * @param {string} gitignoreContent попередньо прочитаний вміст `.gitignore`
 * @returns {void}
 */
function checkGitignoreForLog(reporter, logName, gitignoreContent) {
  const { pass, fail } = reporter
  const logPath = projectLogPath(logName)
  const covers = gitignoreContent
    .split(EOL_RE)
    .map(l => l.trim())
    .some(line => gitignoreLineCoversHookLog(line, logPath))
  if (covers) {
    pass(`.gitignore покриває ${logPath}`)
  } else {
    fail(`.gitignore не ігнорує \`${logPath}\` — додай цей рядок`)
  }
}

/**
 * Перевіряє `.gitignore` для всіх hook-логів одним проходом.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @returns {Promise<void>}
 */
async function checkGitignore(reporter) {
  const { fail } = reporter
  if (!existsSync('.gitignore')) {
    for (const { logName } of HOOK_ARTIFACTS) {
      fail(`.gitignore не існує — додай рядок \`${projectLogPath(logName)}\``)
    }
    return
  }
  const content = await readFile('.gitignore', 'utf8')
  for (const { logName } of HOOK_ARTIFACTS) {
    checkGitignoreForLog(reporter, logName, content)
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
  for (const { scriptName } of HOOK_ARTIFACTS) {
    await checkHookScript(reporter, scriptName)
  }
  checkProjectSettings(reporter)
  await checkGitignore(reporter)
  checkLlmCliAvailable(reporter)
  return reporter.getExitCode()
}
