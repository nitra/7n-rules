/**
 * Синхронізує конфігурацію Claude Code (`.claude/settings.json`,
 * slash-команди для checks, ADR Stop-hook) і Cursor hooks (`.cursor/hooks.json`)
 * у поточний проєкт із темплейтів пакету
 * `npm/.claude-template/`.
 *
 * Архітектура:
 * - `settings.json` — **merge**: користувацькі поля зберігаються; наші hooks
 *   ідентифікуються командою-маркером (`MANAGED_HOOK_COMMAND_MARKERS`) і
 *   перезаписуються; permissions.allow зливається через union (із дедублікацією).
 * - `.claude/commands/n-check.md` — fully owned slash-команда.
 * - `.claude/hooks/capture-decisions.sh` — fully owned bash-скрипт ADR capture Stop-hook;
 *   копіюється з `.claude-template/hooks/`, лише коли в `.n-cursor.json` `rules`
 *   присутнє `adr` (правило увімкнене за замовчуванням; вимикається через
 *   `disable-rules: ["adr"]`). Якщо правила немає, керована ADR-група в hooks
 *   так само автоматично прибирається з settings.json.
 * - `.claude/hooks/normalize-decisions.sh` — fully owned bash-скрипт ADR normalize
 *   Stop-hook (батч-нормалізація чернеток); умови — ті самі, що для `capture`.
 * - `.cursor/hooks.json` — **merge**: користувацькі hooks зберігаються; ADR stop
 *   entries додаються, коли правило `adr` увімкнене, і видаляються, коли вимкнене.
 * - `.gitignore` — **merge** (лише з `adr`): дописує відсутні рядки з канонічного
 *   фрагмента `rules/adr/js/hooks/template/.gitignore.snippet` (`node_modules/`, `dist/`,
 *   `*.secret`, логи capture/normalize, `.normalize-state`, `.normalize.lock`); існуючі
 *   рядки не перезаписуються.
 *
 * Опт-аут — `claude-config: false` у `.n-cursor.json`.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Маркер lint Stop-hook'а (`npx --no \@nitra/cursor stop-hook`). */
export const MANAGED_HOOK_COMMAND_MARKER = '@nitra/cursor stop-hook'
/** Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта capture-decisions. */
export const ADR_HOOK_COMMAND_MARKER = '.claude/hooks/capture-decisions.sh'
/** Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта normalize-decisions. */
export const ADR_NORMALIZE_HOOK_COMMAND_MARKER = '.claude/hooks/normalize-decisions.sh'
/** Маркер Cursor ADR Stop-hook'а — той самий script path, але в `.cursor/hooks.json`. */
export const CURSOR_ADR_HOOK_COMMAND_MARKER = '.claude/hooks/capture-decisions.sh'
/** Маркер Cursor ADR Normalize Stop-hook'а — той самий script path, але в `.cursor/hooks.json`. */
export const CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER = '.claude/hooks/normalize-decisions.sh'
/** Усі маркери managed-hook'ів пакета — за ними відрізняємо свої записи від користувацьких. */
export const MANAGED_HOOK_COMMAND_MARKERS = Object.freeze([
  MANAGED_HOOK_COMMAND_MARKER,
  ADR_HOOK_COMMAND_MARKER,
  ADR_NORMALIZE_HOOK_COMMAND_MARKER
])

const CLAUDE_DIR = '.claude'
const CLAUDE_SETTINGS_FILE = `${CLAUDE_DIR}/settings.json`
const CLAUDE_COMMANDS_DIR = `${CLAUDE_DIR}/commands`
const CLAUDE_HOOKS_DIR = `${CLAUDE_DIR}/hooks`
const CURSOR_DIR = '.cursor'
const CURSOR_HOOKS_FILE = `${CURSOR_DIR}/hooks.json`
const ADR_HOOK_SCRIPT_NAME = 'capture-decisions.sh'
const ADR_NORMALIZE_HOOK_SCRIPT_NAME = 'normalize-decisions.sh'
const TEMPLATE_DIR_NAME = '.claude-template'
/** Відносний шлях до канонічного фрагмента `.gitignore` для ADR Stop-hook'ів у tarball пакета. */
export const ADR_GITIGNORE_SNIPPET_REL = 'rules/adr/js/hooks/template/.gitignore.snippet'
const GITIGNORE_FILE = '.gitignore'
const EOL_RE = /\r?\n/u

/** Канонічна група hooks для ADR capture Stop-hook'а — додається в settings, коли `adr` у `rules`. */
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

/** Канонічна група hooks для ADR normalize Stop-hook'а — батч-нормалізація чернеток у `docs/adr/`. */
const ADR_NORMALIZE_STOP_HOOK_GROUP = Object.freeze({
  matcher: '',
  hooks: Object.freeze([
    Object.freeze({
      type: 'command',
      command: `bash "$CLAUDE_PROJECT_DIR/${ADR_NORMALIZE_HOOK_COMMAND_MARKER}"`,
      async: true,
      timeout: 600
    })
  ])
})

/** Канонічний Cursor stop-hook для ADR capture. Cursor передає payload через stdin JSON. */
const CURSOR_ADR_STOP_HOOK = Object.freeze({
  command: [
    'bash -lc \'root="$PWD";',
    `if [ ! -f "$root/${CURSOR_ADR_HOOK_COMMAND_MARKER}" ] && [ -f "$root/../${CURSOR_ADR_HOOK_COMMAND_MARKER}" ]; then root="$root/.."; fi;`,
    `bash "$root/${CURSOR_ADR_HOOK_COMMAND_MARKER}"'`
  ].join(' '),
  timeout: 180
})

/** Канонічний Cursor stop-hook для ADR normalize. */
const CURSOR_ADR_NORMALIZE_STOP_HOOK = Object.freeze({
  command: [
    'bash -lc \'root="$PWD";',
    `if [ ! -f "$root/${CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER}" ] && [ -f "$root/../${CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER}" ]; then root="$root/.."; fi;`,
    `bash "$root/${CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER}"'`
  ].join(' '),
  timeout: 600
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
 * @typedef {object} CursorHookEntry
 * @property {string} command команда, яку виконує Cursor hook
 * @property {number} [timeout] опційний таймаут у секундах
 */

/**
 * @typedef {object} CursorHooksConfig
 * @property {number} [version] версія Cursor hooks config
 * @property {Record<string, CursorHookEntry[]>} [hooks] hooks за подіями (`stop`, `afterFileEdit`, ...)
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
 * Чи Cursor hook entry належить пакету `@nitra/cursor`.
 * @param {CursorHookEntry} entry один entry з `.cursor/hooks.json`
 * @returns {boolean} `true`, якщо command містить managed ADR marker
 */
function isManagedCursorHookEntry(entry) {
  return (
    typeof entry?.command === 'string' &&
    [CURSOR_ADR_HOOK_COMMAND_MARKER, CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER].some(marker =>
      entry.command.includes(marker)
    )
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
  hooks.Stop = [
    ...(hooks.Stop ?? []),
    /** @type {HookGroup} */ (ADR_STOP_HOOK_GROUP),
    /** @type {HookGroup} */ (ADR_NORMALIZE_STOP_HOOK_GROUP)
  ]
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
 * Зливає `.cursor/hooks.json`: користувацькі entries зберігаються, managed ADR
 * entries у `hooks.stop` перезаписуються або видаляються залежно від `includeAdrHook`.
 * @param {CursorHooksConfig | undefined} existing поточний Cursor hooks config
 * @param {object} [options] опції merge-у
 * @param {boolean} [options.includeAdrHook] чи додати ADR stop entries
 * @returns {CursorHooksConfig} результат злиття
 */
export function mergeCursorHooksConfig(existing, options = {}) {
  /** @type {CursorHooksConfig} */
  const merged = { ...existing }
  /** @type {Record<string, CursorHookEntry[]>} */
  const hooks = {}
  for (const [event, entries] of Object.entries(existing?.hooks ?? {})) {
    hooks[event] = Array.isArray(entries) ? [...entries] : []
  }
  const stop = (hooks.stop ?? []).filter(entry => !isManagedCursorHookEntry(entry))
  if (options.includeAdrHook) {
    stop.push(
      /** @type {CursorHookEntry} */ (CURSOR_ADR_STOP_HOOK),
      /** @type {CursorHookEntry} */ (CURSOR_ADR_NORMALIZE_STOP_HOOK)
    )
  }
  if (stop.length > 0) {
    hooks.stop = stop
  } else {
    delete hooks.stop
  }
  merged.version = typeof merged.version === 'number' ? merged.version : 1
  if (Object.keys(hooks).length > 0) {
    merged.hooks = hooks
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
 * Синхронізує `.cursor/hooks.json` для Cursor Agent stop-hooks. Cursor читає
 * project-level config з `.cursor/hooks.json`; hook scripts лишаються спільними
 * з Claude Code у `.claude/hooks/`.
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {object} [options] опції merge-у
 * @param {boolean} [options.includeAdrHook] чи додавати ADR stop-hook entries
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
export async function syncCursorHooksConfig(projectRoot, options = {}) {
  const hooksPath = join(projectRoot, CURSOR_HOOKS_FILE)
  if (!options.includeAdrHook && !existsSync(hooksPath)) {
    return { written: false, path: '' }
  }
  const existing = /** @type {CursorHooksConfig | undefined} */ (await readJsonOrUndefined(hooksPath))
  const merged = mergeCursorHooksConfig(existing, options)
  await mkdir(join(projectRoot, CURSOR_DIR), { recursive: true })
  await writeFile(hooksPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  return { written: true, path: CURSOR_HOOKS_FILE }
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
 * Копіює один канонічний bash-скрипт hook'а з темплейту пакета у `.claude/hooks/`.
 * Файл повністю керується пакетом — на кожен sync перезаписується (як setup-bun-deps).
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {string} templateDir каталог `.claude-template/` усередині пакету
 * @param {string} scriptName базове ім'я скрипта (наприклад `capture-decisions.sh`)
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
async function syncHookScript(projectRoot, templateDir, scriptName) {
  const templatePath = join(templateDir, 'hooks', scriptName)
  if (!existsSync(templatePath)) {
    return { written: false, path: '' }
  }
  const content = await readFile(templatePath, 'utf8')
  const hooksDir = join(projectRoot, CLAUDE_HOOKS_DIR)
  await mkdir(hooksDir, { recursive: true })
  const destPath = join(hooksDir, scriptName)
  await writeFile(destPath, content, 'utf8')
  await chmod(destPath, 0o755)
  return { written: true, path: `${CLAUDE_HOOKS_DIR}/${scriptName}` }
}

/**
 * Копіює канонічний `.claude/hooks/capture-decisions.sh` з темплейту пакета.
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {string} templateDir каталог `.claude-template/` усередині пакету
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
export function syncAdrHookScript(projectRoot, templateDir) {
  return syncHookScript(projectRoot, templateDir, ADR_HOOK_SCRIPT_NAME)
}

/**
 * Копіює канонічний `.claude/hooks/normalize-decisions.sh` з темплейту пакета.
 * @param {string} projectRoot корінь проєкту, куди писати
 * @param {string} templateDir каталог `.claude-template/` усередині пакету
 * @returns {Promise<{ written: boolean, path: string }>} результат: чи писали файл, та його відносний шлях
 */
export function syncAdrNormalizeHookScript(projectRoot, templateDir) {
  return syncHookScript(projectRoot, templateDir, ADR_NORMALIZE_HOOK_SCRIPT_NAME)
}

/**
 * Повертає змістовні (не коментар, не порожній) рядки з text-фрагмента `.gitignore`.
 * @param {string} raw вміст snippet-файлу
 * @returns {string[]} нормалізовані рядки патернів
 */
function parseGitignoreFragmentLines(raw) {
  return raw
    .split(EOL_RE)
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'))
}

/**
 * Дописує в кореневий `.gitignore` проєкту відсутні рядки з канонічного ADR-фрагмента.
 * @param {string} projectRoot корінь проєкту-споживача
 * @param {string} bundledPackageRoot корінь установленого `@nitra/cursor`
 * @returns {Promise<{ written: boolean, path: string }>} чи змінено файл і відносний шлях
 */
export async function syncGitignoreAdrFragment(projectRoot, bundledPackageRoot) {
  const snippetPath = join(bundledPackageRoot, ADR_GITIGNORE_SNIPPET_REL)
  if (!existsSync(snippetPath)) {
    return { written: false, path: '' }
  }
  const fragment = await readFile(snippetPath, 'utf8')
  const required = parseGitignoreFragmentLines(fragment)
  if (required.length === 0) {
    return { written: false, path: '' }
  }

  const destPath = join(projectRoot, GITIGNORE_FILE)
  const existing = existsSync(destPath) ? await readFile(destPath, 'utf8') : ''
  const existingLines = new Set(
    existing
      .split(EOL_RE)
      .map(l => l.trim())
      .filter(l => l !== '' && !l.startsWith('#'))
  )
  const missing = required.filter(l => !existingLines.has(l))
  if (missing.length === 0) {
    return { written: false, path: GITIGNORE_FILE }
  }

  const sectionHeader = '# @nitra/cursor (adr) — локальні артефакти Stop-hook, не коміти'
  const hasHeader = existing.split(EOL_RE).some(l => l.trim() === sectionHeader)
  const block = hasHeader ? missing.join('\n') : [sectionHeader, ...missing].join('\n')
  let prefix = ''
  if (existing.length > 0) {
    prefix = existing.endsWith('\n') ? existing : `${existing}\n`
  }
  const next = `${prefix}${block}\n`
  await writeFile(destPath, next, 'utf8')
  return { written: true, path: GITIGNORE_FILE }
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
 * @returns {Promise<{ settings: boolean, cursorHooks: boolean, commands: string[], adrHook: boolean, adrNormalizeHook: boolean, gitignoreAdr: boolean }>} прапорці записів settings/Cursor hooks/ADR-hook(s)/`.gitignore` та список slash-команд
 */
export async function syncClaudeConfig({ projectRoot, bundledPackageRoot, enabled, rules = [] }) {
  if (!enabled) {
    return {
      settings: false,
      cursorHooks: false,
      commands: [],
      adrHook: false,
      adrNormalizeHook: false,
      gitignoreAdr: false
    }
  }
  const templateDir = join(bundledPackageRoot, TEMPLATE_DIR_NAME)
  if (!existsSync(templateDir)) {
    return {
      settings: false,
      cursorHooks: false,
      commands: [],
      adrHook: false,
      adrNormalizeHook: false,
      gitignoreAdr: false
    }
  }
  const includeAdrHook = Array.isArray(rules) && rules.includes('adr')
  const adrHook = includeAdrHook ? await syncAdrHookScript(projectRoot, templateDir) : { written: false, path: '' }
  const adrNormalizeHook = includeAdrHook
    ? await syncAdrNormalizeHookScript(projectRoot, templateDir)
    : { written: false, path: '' }
  const gitignoreAdr = includeAdrHook
    ? await syncGitignoreAdrFragment(projectRoot, bundledPackageRoot)
    : { written: false, path: '' }
  const settings = await syncClaudeSettings(projectRoot, templateDir, { includeAdrHook })
  const cursorHooks = await syncCursorHooksConfig(projectRoot, { includeAdrHook })
  const commands = await syncClaudeCommands(projectRoot, templateDir)
  return {
    settings: settings.written,
    cursorHooks: cursorHooks.written,
    commands,
    adrHook: adrHook.written,
    adrNormalizeHook: adrNormalizeHook.written,
    gitignoreAdr: gitignoreAdr.written
  }
}
