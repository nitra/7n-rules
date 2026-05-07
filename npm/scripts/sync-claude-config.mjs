/**
 * Синхронізує конфігурацію Claude Code (`.claude/settings.json`, `npm/CLAUDE.md`,
 * slash-команди для checks, ADR Stop-hook) у поточний проєкт із темплейтів пакету
 * `npm/.claude-template/`.
 *
 * Архітектура:
 * - `settings.json` — **merge**: користувацькі поля зберігаються; наші hooks
 *   ідентифікуються командою-маркером (`MANAGED_HOOK_COMMAND_MARKERS`) і
 *   перезаписуються; permissions.allow зливається через union (із дедублікацією).
 * - `npm/CLAUDE.md` — **fully owned**: завжди перезаписується; пропускається,
 *   якщо в проєкті немає каталогу `npm/`.
 * - `.claude/commands/n-check.md` — fully owned slash-команда.
 * - `.claude/hooks/capture-decisions.sh` — fully owned bash-скрипт ADR Stop-hook;
 *   копіюється з `.claude-template/hooks/`, лише коли в `.n-cursor.json` `rules`
 *   присутнє `adr` (правило вмикається вручну). Якщо правила немає, керована
 *   ADR-група в hooks так само автоматично прибирається з settings.json.
 *
 * Опт-аут — `claude-config: false` у `.n-cursor.json`.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Маркер lint Stop-hook'а (`npx --no @nitra/cursor stop-hook`). */
export const MANAGED_HOOK_COMMAND_MARKER = '@nitra/cursor stop-hook'
/** Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта. */
export const ADR_HOOK_COMMAND_MARKER = '.claude/hooks/capture-decisions.sh'
/** Усі маркери managed-hook'ів пакета — за ними відрізняємо свої записи від користувацьких. */
export const MANAGED_HOOK_COMMAND_MARKERS = Object.freeze([MANAGED_HOOK_COMMAND_MARKER, ADR_HOOK_COMMAND_MARKER])

const CLAUDE_DIR = '.claude'
const CLAUDE_SETTINGS_FILE = `${CLAUDE_DIR}/settings.json`
const CLAUDE_COMMANDS_DIR = `${CLAUDE_DIR}/commands`
const CLAUDE_HOOKS_DIR = `${CLAUDE_DIR}/hooks`
const ADR_HOOK_SCRIPT_NAME = 'capture-decisions.sh'
const NPM_CLAUDE_MD_FILE = 'npm/CLAUDE.md'
const TEMPLATE_DIR_NAME = '.claude-template'

/** Канонічна група hooks для ADR Stop-hook'а — додається в settings, коли `adr` у `rules`. */
const ADR_STOP_HOOK_GROUP = Object.freeze({
  matcher: '',
  hooks: Object.freeze([
    Object.freeze({
      type: 'command',
      command: `bash "$CLAUDE_PROJECT_DIR/${ADR_HOOK_COMMAND_MARKER}"`,
      async: true,
      timeout: 180
    })
  ])
})

/**
 * @typedef {object} HookEntry
 * @property {string} type тип hook'а у форматі Claude Code (зазвичай `'command'`)
 * @property {string} command команда, яку виконує Claude Code (наш маркер живе саме тут)
 * @property {number} [timeout] опційний таймаут у секундах
 */

/**
 * @typedef {object} HookGroup
 * @property {string} [matcher] патерн (наприклад, `'.*'`) для звуження hook'а
 * @property {HookEntry[]} hooks впорядкований список команд hook-групи
 */

/**
 * @typedef {object} ClaudeSettings
 * @property {{ allow?: string[] }} [permissions] секція `permissions` із .claude/settings.json
 * @property {Record<string, HookGroup[]>} [hooks] hooks за подіями (`Stop`, `PreToolUse`, ...)
 */

/**
 * Чи hook-група містить лише наші managed-команди (за будь-яким із маркерів пакета).
 * @param {HookGroup} group hook-група з .claude/settings.json
 * @returns {boolean} `true`, якщо всі hooks мають маркер з `MANAGED_HOOK_COMMAND_MARKERS`
 */
function isManagedHookGroup(group) {
  if (!group?.hooks?.length) {
    return false
  }
  return group.hooks.every(
    h => typeof h?.command === 'string' && MANAGED_HOOK_COMMAND_MARKERS.some(marker => h.command.includes(marker))
  )
}

/**
 * Зливає список allow-permissions: union існуючого і темплейтного без дублікатів,
 * порядок — спочатку існуючі (щоб не міняти користувацький порядок), потім нові.
 * @param {string[] | undefined} existing існуючий список з `.claude/settings.json` користувача
 * @param {string[] | undefined} fromTemplate список з темплейту пакета `@nitra/cursor`
 * @returns {string[]} об'єднаний список без дублікатів (порядок: існуючі, потім нові)
 */
export function mergeAllowList(existing, fromTemplate) {
  const out = []
  const seen = new Set()
  for (const arr of [existing ?? [], fromTemplate ?? []]) {
    for (const item of arr) {
      if (typeof item !== 'string' || seen.has(item)) {
        continue
      }
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

/**
 * Зливає hooks-секцію: для кожної події в темплейті видаляємо managed-групи
 * з існуючої конфігурації і додаємо актуальні з темплейту. Немені події в
 * темплейті не чіпаються.
 * @param {Record<string, HookGroup[]> | undefined} existing поточна `hooks`-секція з .claude/settings.json
 * @param {Record<string, HookGroup[]> | undefined} fromTemplate цільова `hooks`-секція з темплейту
 * @returns {Record<string, HookGroup[]>} результат злиття (порожні події видаляються)
 */
export function mergeHooks(existing, fromTemplate) {
  /** @type {Record<string, HookGroup[]>} */
  const out = {}
  for (const [event, groups] of Object.entries(existing ?? {})) {
    out[event] = Array.isArray(groups) ? [...groups] : []
  }
  for (const [event, templateGroups] of Object.entries(fromTemplate ?? {})) {
    const existingGroups = (out[event] ?? []).filter(g => !isManagedHookGroup(g))
    out[event] = [...existingGroups, ...(templateGroups ?? [])]
    if (out[event].length === 0) {
      delete out[event]
    }
  }
  return out
}

/**
 * Будує копію темплейту із додатковою ADR Stop hook-групою у `Stop`.
 * Темплейт залишається незмінним; повертається новий об'єкт з доданою групою.
 * @param {ClaudeSettings} template вихідний темплейт із `.claude-template/settings.template.json`
 * @returns {ClaudeSettings} копія з доданою ADR-групою у `hooks.Stop`
 */
function templateWithAdrHook(template) {
  /** @type {Record<string, HookGroup[]>} */
  const hooks = {}
  for (const [event, groups] of Object.entries(template.hooks ?? {})) {
    hooks[event] = Array.isArray(groups) ? [...groups] : []
  }
  hooks.Stop = [...(hooks.Stop ?? []), /** @type {HookGroup} */ (ADR_STOP_HOOK_GROUP)]
  return { ...template, hooks }
}

/**
 * Повертає об'єднаний об'єкт settings.json.
 * @param {ClaudeSettings | undefined} existing існуючий вміст `.claude/settings.json` користувача (або undefined, якщо файла нема)
 * @param {ClaudeSettings} template settings із темплейту пакета `@nitra/cursor`
 * @param {object} [options] опції merge-у
 * @param {boolean} [options.includeAdrHook] чи додати ADR Stop-hook групу до managed-hooks (коли в `.n-cursor.json` `rules` присутнє `adr`)
 * @returns {ClaudeSettings} результат merge-у (користувацькі поля збережено, наші перевизначено)
 */
export function mergeSettings(existing, template, options = {}) {
  const effectiveTemplate = options.includeAdrHook ? templateWithAdrHook(template) : template
  /** @type {ClaudeSettings} */
  const merged = { ...existing }
  const mergedAllow = mergeAllowList(existing?.permissions?.allow, effectiveTemplate.permissions?.allow)
  if (mergedAllow.length > 0) {
    merged.permissions = { ...existing?.permissions, allow: mergedAllow }
  }
  const mergedHooks = mergeHooks(existing?.hooks, effectiveTemplate.hooks)
  if (Object.keys(mergedHooks).length > 0) {
    merged.hooks = mergedHooks
  } else {
    delete merged.hooks
  }
  return merged
}

/**
 * Читає JSON-файл; якщо файл відсутній або не валідний — повертає `undefined`.
 * @param {string} path абсолютний шлях до JSON-файлу
 * @returns {Promise<ClaudeSettings | undefined>} розпарсений об'єкт або `undefined` (файл відсутній / невалідний)
 */
async function readJsonOrUndefined(path) {
  if (!existsSync(path)) {
    return
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return
  }
}

/**
 * Синхронізує `.claude/settings.json` за темплейтом, зберігаючи решту
 * користувацьких полів.
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {string} templateDir каталог `.claude-template/` усередині пакету
 * @param {object} [options] опції merge-у
 * @param {boolean} [options.includeAdrHook] чи додавати ADR Stop-hook (правило `adr` увімкнене у `rules`)
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
export async function syncClaudeSettings(projectRoot, templateDir, options = {}) {
  const templatePath = join(templateDir, 'settings.template.json')
  if (!existsSync(templatePath)) {
    return { written: false, path: '' }
  }
  const template = /** @type {ClaudeSettings} */ (JSON.parse(await readFile(templatePath, 'utf8')))
  const settingsPath = join(projectRoot, CLAUDE_SETTINGS_FILE)
  const existing = await readJsonOrUndefined(settingsPath)
  const merged = mergeSettings(existing, template, options)
  await mkdir(join(projectRoot, CLAUDE_DIR), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  return { written: true, path: CLAUDE_SETTINGS_FILE }
}

/**
 * Копіює канонічний `.claude/hooks/capture-decisions.sh` з темплейту пакета.
 * Файл повністю керується пакетом — на кожен sync перезаписується (як setup-bun-deps).
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {string} templateDir каталог `.claude-template/` усередині пакету
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
export async function syncAdrHookScript(projectRoot, templateDir) {
  const templatePath = join(templateDir, 'hooks', ADR_HOOK_SCRIPT_NAME)
  if (!existsSync(templatePath)) {
    return { written: false, path: '' }
  }
  const content = await readFile(templatePath, 'utf8')
  const hooksDir = join(projectRoot, CLAUDE_HOOKS_DIR)
  await mkdir(hooksDir, { recursive: true })
  const destPath = join(hooksDir, ADR_HOOK_SCRIPT_NAME)
  await writeFile(destPath, content, 'utf8')
  await chmod(destPath, 0o755)
  return { written: true, path: `${CLAUDE_HOOKS_DIR}/${ADR_HOOK_SCRIPT_NAME}` }
}

/**
 * Копіює `npm/CLAUDE.md` з темплейту, якщо в проєкті є каталог `npm/`.
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {string} templateDir каталог `.claude-template/` усередині пакету `@nitra/cursor`
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
export async function syncNpmClaudeMd(projectRoot, templateDir) {
  if (!existsSync(join(projectRoot, 'npm'))) {
    return { written: false, path: '' }
  }
  const templatePath = join(templateDir, 'npm-CLAUDE.md')
  if (!existsSync(templatePath)) {
    return { written: false, path: '' }
  }
  const content = await readFile(templatePath, 'utf8')
  await writeFile(join(projectRoot, NPM_CLAUDE_MD_FILE), content, 'utf8')
  return { written: true, path: NPM_CLAUDE_MD_FILE }
}

/**
 * Копіює всі slash-команди з `templateDir/commands/` у `.claude/commands/`.
 * Команди ідентифікуються тим, що вони лежать у темплейті — не перетинаються
 * з командами скілів (n-fix, n-lint, ...).
 * @param {string} projectRoot корінь проєкту-споживача
 * @param {string} templateDir каталог `.claude-template/` усередині пакету `@nitra/cursor`
 * @returns {Promise<string[]>} масив відносних шляхів записаних файлів
 */
export async function syncClaudeCommands(projectRoot, templateDir) {
  const commandsTemplateDir = join(templateDir, 'commands')
  if (!existsSync(commandsTemplateDir)) {
    return []
  }
  const targetDir = join(projectRoot, CLAUDE_COMMANDS_DIR)
  await mkdir(targetDir, { recursive: true })
  const written = []
  for (const name of await readdir(commandsTemplateDir)) {
    if (!name.endsWith('.md')) {
      continue
    }
    const content = await readFile(join(commandsTemplateDir, name), 'utf8')
    await writeFile(join(targetDir, name), content, 'utf8')
    written.push(`${CLAUDE_COMMANDS_DIR}/${name}`)
  }
  return written
}

/**
 * Виконує повну синхронізацію Claude Code-конфігу з темплейту пакету в проєкт.
 * Використовується з `bin/n-cursor.js` після інших синків.
 * @param {object} options опції синку
 * @param {string} options.projectRoot корінь проєкту-споживача
 * @param {string} options.bundledPackageRoot корінь установленого `@nitra/cursor`
 * @param {boolean} options.enabled чи увімкнено sync (з `.n-cursor.json` `claude-config`)
 * @param {string[]} [options.rules] список увімкнених правил із `.n-cursor.json` — впливає на ADR Stop-hook (`adr`)
 * @returns {Promise<{ settings: boolean, npmClaudeMd: boolean, commands: string[], adrHook: boolean }>} прапорці записів settings/CLAUDE.md/ADR-hook та список записаних slash-команд
 */
export async function syncClaudeConfig({ projectRoot, bundledPackageRoot, enabled, rules = [] }) {
  if (!enabled) {
    return { settings: false, npmClaudeMd: false, commands: [], adrHook: false }
  }
  const templateDir = join(bundledPackageRoot, TEMPLATE_DIR_NAME)
  if (!existsSync(templateDir)) {
    return { settings: false, npmClaudeMd: false, commands: [], adrHook: false }
  }
  const includeAdrHook = Array.isArray(rules) && rules.includes('adr')
  const adrHook = includeAdrHook ? await syncAdrHookScript(projectRoot, templateDir) : { written: false, path: '' }
  const settings = await syncClaudeSettings(projectRoot, templateDir, { includeAdrHook })
  const npmClaudeMd = await syncNpmClaudeMd(projectRoot, templateDir)
  const commands = await syncClaudeCommands(projectRoot, templateDir)
  return { settings: settings.written, npmClaudeMd: npmClaudeMd.written, commands, adrHook: adrHook.written }
}
