/** @see ./docs/hooks.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Один hook-артефакт: bash-скрипт + його лог-файл, які перевіряємо однотипно. */
const HOOK_ARTIFACTS = /** @type {const} */ ([
  { scriptName: 'capture-decisions.sh', logName: 'capture-decisions.log' },
  { scriptName: 'normalize-decisions.sh', logName: 'normalize-decisions.log' }
])

const PROJECT_SETTINGS_REL = '.claude/settings.json'
const CURSOR_HOOKS_REL = '.cursor/hooks.json'
const EOL_RE = /\r?\n/u

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLED_HOOKS_DIR = join(here, '..', '..', '..', '.claude-template', 'hooks')

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
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @param {string} cwd корінь репозиторію
 * @param {string} scriptName базове ім'я скрипта (наприклад `capture-decisions.sh`)
 * @returns {Promise<void>}
 */
async function checkHookScript(reporter, cwd, scriptName) {
  const { pass, fail } = reporter
  const projectRel = projectHookPath(scriptName)
  const projectAbs = join(cwd, projectRel)
  const bundledPath = join(BUNDLED_HOOKS_DIR, scriptName)
  if (!existsSync(projectAbs)) {
    fail(`${projectRel} не існує — запусти \`npx @nitra/cursor\` (правило adr копіює канонічний скрипт)`)
    return
  }
  if (!existsSync(bundledPath)) {
    fail(`канонічний скрипт у пакеті не знайдено: ${bundledPath} — перевстанови @nitra/cursor`)
    return
  }
  const [project, bundled] = await Promise.all([readFile(projectAbs, 'utf8'), readFile(bundledPath, 'utf8')])
  if (project === bundled) {
    pass(`${projectRel} збігається з канонічним`)
  } else {
    fail(`${projectRel} відрізняється від канонічного — запусти \`npx @nitra/cursor\` для повторного синку`)
  }
}

/**
 * FS-existence для project-shared `.claude/settings.json` і
 * `.claude/settings.local.json`. Структуру (`hooks.Stop[]` містить групу з
 * `capture-decisions.sh`; `settings.local.json` не дублює) валідують
 * `npm/policy/adr/settings_json/` і `npm/policy/adr/settings_local_json/`.
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер
 * @param {string} cwd корінь репозиторію
 */
function checkProjectSettings(reporter, cwd) {
  const { pass, fail } = reporter
  if (existsSync(join(cwd, PROJECT_SETTINGS_REL))) {
    pass(`${PROJECT_SETTINGS_REL} є (Stop-hook перевіряє npx @nitra/cursor fix → adr.settings_json)`)
  } else {
    fail(`${PROJECT_SETTINGS_REL} не існує — запусти \`npx @nitra/cursor\``)
  }
}

/**
 * Читає JSON-файл із диска без винятку.
 * @param {string} path відносний шлях до JSON-файлу
 * @returns {Promise<unknown | null>} розпарсений JSON або null
 */
async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Чи має Cursor hooks config stop-entry з потрібним command marker.
 * @param {unknown} config розпарсений `.cursor/hooks.json`
 * @param {string} marker підрядок, який має бути в `command`
 * @returns {boolean} true, якщо marker знайдено у `hooks.stop[]`
 */
function cursorConfigHasStopHook(config, marker) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return false
  }
  const hooks = /** @type {{ hooks?: unknown }} */ (config).hooks
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return false
  }
  const stop = /** @type {{ stop?: unknown }} */ (hooks).stop
  if (!Array.isArray(stop)) {
    return false
  }
  return stop.some(entry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return false
    }
    const command = /** @type {{ command?: unknown }} */ (entry).command
    return typeof command === 'string' && command.includes(marker)
  })
}

/**
 * Перевіряє project-level Cursor hooks config для ADR stop-hooks.
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<void>}
 */
async function checkCursorHooks(reporter, cwd) {
  const { pass, fail } = reporter
  const cursorHooksAbs = join(cwd, CURSOR_HOOKS_REL)
  if (!existsSync(cursorHooksAbs)) {
    fail(`${CURSOR_HOOKS_REL} не існує — запусти \`npx @nitra/cursor\``)
    return
  }
  const config = await readJsonSafe(cursorHooksAbs)
  if (config === null) {
    fail(`${CURSOR_HOOKS_REL} не парситься як JSON — запусти \`npx @nitra/cursor\` або виправ файл`)
    return
  }
  for (const { scriptName } of HOOK_ARTIFACTS) {
    const marker = projectHookPath(scriptName)
    if (cursorConfigHasStopHook(config, marker)) {
      pass(`${CURSOR_HOOKS_REL} має stop-hook для ${marker}`)
    } else {
      fail(`${CURSOR_HOOKS_REL}: відсутній stop-hook для \`${marker}\` (adr.mdc)`)
    }
  }
}

/**
 * Перевіряє `.gitignore` на ігнорування лог-файлу одного хука.
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
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
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<void>}
 */
async function checkGitignore(reporter, cwd) {
  const { fail } = reporter
  const gitignoreAbs = join(cwd, '.gitignore')
  if (!existsSync(gitignoreAbs)) {
    for (const { logName } of HOOK_ARTIFACTS) {
      fail(`.gitignore не існує — додай рядок \`${projectLogPath(logName)}\``)
    }
    return
  }
  const content = await readFile(gitignoreAbs, 'utf8')
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
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
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
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  for (const { scriptName } of HOOK_ARTIFACTS) {
    await checkHookScript(reporter, cwd, scriptName)
  }
  checkProjectSettings(reporter, cwd)
  await checkCursorHooks(reporter, cwd)
  await checkGitignore(reporter, cwd)
  checkLlmCliAvailable(reporter)
  return reporter.getExitCode()
}
