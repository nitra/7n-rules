/** @see ./docs/hooks.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

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
  if (line === '.claude/hooks/*' || line === '.claude/hooks/**') {
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
    fail(`${projectRel} не існує — запусти \`npx @7n/rules\` (правило adr копіює канонічний скрипт)`)
    return
  }
  if (!existsSync(bundledPath)) {
    fail(`канонічний скрипт у пакеті не знайдено: ${bundledPath} — перевстанови @7n/rules`)
    return
  }
  const [project, bundled] = await Promise.all([readFile(projectAbs, 'utf8'), readFile(bundledPath, 'utf8')])
  if (project === bundled) {
    pass(`${projectRel} збігається з канонічним`)
  } else {
    fail(`${projectRel} відрізняється від канонічного — запусти \`npx @7n/rules\` для повторного синку`)
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
    pass(`${PROJECT_SETTINGS_REL} є (Stop-hook перевіряє npx @7n/rules fix → adr.settings_json)`)
  } else {
    fail(`${PROJECT_SETTINGS_REL} не існує — запусти \`npx @7n/rules\``)
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
    fail(`${CURSOR_HOOKS_REL} не існує — запусти \`npx @7n/rules\``)
    return
  }
  const config = await readJsonSafe(cursorHooksAbs)
  if (config === null) {
    fail(`${CURSOR_HOOKS_REL} не парситься як JSON — запусти \`npx @7n/rules\` або виправ файл`)
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
 * npm-first пошук `pi`-бінарника (як `find_pi_cmd` у capture-decisions.sh): root
 * `.bin` (hoisted) -> nested `@7n/rules` `.bin` -> system `PATH`.
 * @param {string} cwd корінь репозиторію
 * @returns {string | null} шлях/ім'я бінарника або `null`, якщо не знайдено
 */
function findPiCmd(cwd) {
  const candidates = [
    join(cwd, 'node_modules', '.bin', 'pi'),
    join(cwd, 'node_modules', '@nitra', 'cursor', 'node_modules', '.bin', 'pi')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return isBinaryInPath('pi') ? 'pi' : null
}

/**
 * Інформативна перевірка (завжди `pass`) capture-бекенду: дефолтний `pi` (npm-first
 * lookup + локальна модель) і cloud-фолбек `claude`/`cursor-agent`, доступний через
 * `CAPTURE_DECISIONS_BACKEND=claude|cursor-agent|auto`. Жоден стан не блокує — capture
 * best-effort, hook мовчки no-op'ає без доступного бекенду (spec 2026-06-30).
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 * @param {string} cwd корінь репозиторію
 * @returns {void}
 */
function checkCaptureBackendAvailable(reporter, cwd) {
  const { pass } = reporter
  const backend = env.CAPTURE_DECISIONS_BACKEND || 'pi'
  const piCmd = findPiCmd(cwd)
  const hasLocalModel = Boolean(env.CAPTURE_DECISIONS_PI_MODEL || env.N_LOCAL_MIN_MODEL)
  const hasClaude = isBinaryInPath('claude')
  const hasCursor = isBinaryInPath('cursor-agent')

  const piStatus = piCmd
    ? hasLocalModel
      ? `pi знайдено (${piCmd}), локальна модель сконфігурована`
      : `pi знайдено (${piCmd}), але CAPTURE_DECISIONS_PI_MODEL/N_LOCAL_MIN_MODEL не задано — capture skipне`
    : 'pi не знайдено (root .bin, nested @7n/rules .bin, PATH) — capture skipне'
  const cloudStatus =
    hasClaude && hasCursor
      ? 'claude і cursor-agent доступні'
      : hasClaude
        ? 'claude доступний, cursor-agent відсутній'
        : hasCursor
          ? 'cursor-agent доступний, claude відсутній'
          : 'жодного cloud-бекенду не знайдено'

  pass(`Capture backend (CAPTURE_DECISIONS_BACKEND=${backend}): ${piStatus}; cloud-фолбек: ${cloudStatus}`)
}

/** Файли стану/блокування normalize-хука, які не мають потрапляти в git. */
const NORMALIZE_STATE_FILES = ['.normalize-state', '.normalize.lock']
const CLAUDE_HOOKS_REL = '.claude/hooks'

/**
 * Перевіряє рядок `.gitignore` на покриття конкретного state/lock файлу.
 * @param {string} line нормалізований (trim) рядок
 * @param {string} statePath відносний шлях файлу (наприклад `.claude/hooks/.normalize-state`)
 * @returns {boolean} true — рядок покриває файл
 */
function gitignoreLineCoversStatePath(line, statePath) {
  if (line === statePath) return true
  // .claude/hooks/* або .claude/hooks/**
  if (line === `${CLAUDE_HOOKS_REL}/*` || line === `${CLAUDE_HOOKS_REL}/**`) return true
  return false
}

/**
 * Перевіряє `.gitignore` на наявність рядків для файлів стану normalize-хука.
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер pass/fail
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<void>}
 */
async function checkGitignoreForStateFiles(reporter, cwd) {
  const { pass, fail } = reporter
  const gitignoreAbs = join(cwd, '.gitignore')
  const content = existsSync(gitignoreAbs) ? await readFile(gitignoreAbs, 'utf8') : ''
  const lines = content.split(EOL_RE).map(l => l.trim())
  for (const file of NORMALIZE_STATE_FILES) {
    const statePath = `${CLAUDE_HOOKS_REL}/${file}`
    if (lines.some(l => gitignoreLineCoversStatePath(l, statePath))) {
      pass(`.gitignore покриває ${statePath}`)
    } else {
      fail(`.gitignore не ігнорує \`${statePath}\` — додай рядок (adr.mdc)`)
    }
  }
}

/**
 * Перевіряє наявність каталогу `docs/adr/` — обов'язкового місця зберігання ADR-ів.
 * @param {import('../../../scripts/lib/check-reporter.mjs').CheckReporter} reporter репортер pass/fail
 * @param {string} cwd корінь репозиторію
 * @returns {void}
 */
function checkDocsAdrDir(reporter, cwd) {
  const { pass, fail } = reporter
  const adrDir = join(cwd, 'docs', 'adr')
  if (existsSync(adrDir)) {
    pass('docs/adr/ існує (каталог ADR-ів)')
  } else {
    fail('docs/adr/ відсутній — створи каталог для ADR-ів (adr.mdc)')
  }
}

/**
 * Перевіряє відповідність проєкту правилам adr.mdc.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  for (const { scriptName } of HOOK_ARTIFACTS) {
    await checkHookScript(reporter, cwd, scriptName)
  }
  checkProjectSettings(reporter, cwd)
  await checkCursorHooks(reporter, cwd)
  await checkGitignore(reporter, cwd)
  await checkGitignoreForStateFiles(reporter, cwd)
  checkDocsAdrDir(reporter, cwd)
  checkCaptureBackendAvailable(reporter, cwd)
  return reporter.result()
}
