/**
 * Синхронізує конфігурацію Claude Code (`.claude/settings.json`,
 * slash-команди з `commands/` темплейту, ADR Stop-hook) і Cursor hooks
 * (`.cursor/hooks.json`) у поточний проєкт із темплейтів пакету
 * `npm/.claude-template/`.
 *
 * Архітектура:
 * - `settings.json` — **merge**: користувацькі поля зберігаються; наші hooks
 *   ідентифікуються командою-маркером (`MANAGED_HOOK_COMMAND_MARKERS`) і
 *   перезаписуються; permissions.allow зливається через union (із дедублікацією).
 * - `.claude/commands/*.md` — fully owned slash-команди з темплейту
 *   `.claude-template/commands/` (зараз порожньо; sync no-op).
 * - `.claude/hooks/capture-decisions.sh` — fully owned bash-скрипт ADR capture Stop-hook;
 *   копіюється з `.claude-template/hooks/`, лише коли в `.n-rules.json` `rules`
 *   присутнє `adr` (правило увімкнене за замовчуванням; вимикається через
 *   `disable-rules: ["adr"]`). Якщо правила немає, керована ADR-група в hooks
 *   так само автоматично прибирається з settings.json.
 * - `.claude/hooks/normalize-decisions.sh` — fully owned bash-скрипт ADR normalize
 *   Stop-hook (батч-нормалізація чернеток); умови — ті самі, що для `capture`.
 * - `.cursor/hooks.json` — **merge**: користувацькі hooks зберігаються; ADR stop
 *   entries додаються, коли правило `adr` увімкнене, і видаляються, коли вимкнене.
 * - `.gitignore` — **merge** (лише з `adr`): дописує відсутні рядки з канонічного
 *   фрагмента `.claude-template/hooks/.gitignore.snippet` (`node_modules/`, `dist/`,
 *   `*.secret`, логи capture/normalize, `.normalize-state`, `.normalize.lock`,
 *   `.claude/scheduled_tasks.lock`); існуючі рядки не перезаписуються.
 *
 * Опт-аут — `claude-config: false` у `.n-rules.json`.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Маркер hook-ів пакета (`hook --post-tool-use`, `hook --stop`). */
export const MANAGED_HOOK_COMMAND_MARKER = '@7n/rules hook'
/** @deprecated — маркер hook-ів до перейменування пакету на `@7n/rules`; лишається для cleanup наявних конфігів при ресинку. */
export const LEGACY_PACKAGE_HOOK_COMMAND_MARKER = '@nitra/cursor hook'
/** @deprecated — замінено на `hook --post-tool-use`; маркер лишається для cleanup наявних конфігів при ресинку. */
export const LEGACY_POST_TOOL_USE_HOOK_COMMAND_MARKER = '@nitra/cursor post-tool-use-check'
/** @deprecated — ще старіша мутуюча PostToolUse-команда (`post-tool-use-fix`); маркер лишається для cleanup наявних конфігів при ресинку. */
export const LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER = '@nitra/cursor post-tool-use-fix'
/** @deprecated — doc-files hook перенесено до `hook --post-tool-use`; маркер лишається для cleanup наявних конфігів при ресинку. */
export const DOC_FILES_HOOK_COMMAND_MARKER = '@nitra/cursor lint-doc-files'
/** @deprecated — ще старіший legacy-маркер doc-files hook'ів (`doc-files check`) — cleanup при ресинку. */
export const LEGACY_DOC_FILES_HOOK_COMMAND_MARKER = '@nitra/cursor doc-files check'
/** Legacy-маркер старого Stop-hook'а — лишаємо для cleanup-у при оновленні існуючих інсталяцій. */
export const LEGACY_STOP_HOOK_COMMAND_MARKER = '@nitra/cursor stop-hook'
/** Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта capture-decisions. */
export const ADR_HOOK_COMMAND_MARKER = '.claude/hooks/capture-decisions.sh'
/** Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта normalize-decisions. */
export const ADR_NORMALIZE_HOOK_COMMAND_MARKER = '.claude/hooks/normalize-decisions.sh'
/** Маркер Cursor ADR Stop-hook'а — той самий script path, але в `.cursor/hooks.json`. */
export const CURSOR_ADR_HOOK_COMMAND_MARKER = '.claude/hooks/capture-decisions.sh'
/** Маркер Cursor ADR Normalize Stop-hook'а — той самий script path, але в `.cursor/hooks.json`. */
export const CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER = '.claude/hooks/normalize-decisions.sh'
/**
 * Усі маркери managed-hook'ів пакета — за ними відрізняємо свої записи від користувацьких.
 * Legacy stop-hook включений сюди, щоб старі entries автоматично видалялись при наступному sync-у.
 */
export const MANAGED_HOOK_COMMAND_MARKERS = Object.freeze([
  MANAGED_HOOK_COMMAND_MARKER,
  LEGACY_PACKAGE_HOOK_COMMAND_MARKER,
  LEGACY_POST_TOOL_USE_HOOK_COMMAND_MARKER,
  LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER,
  DOC_FILES_HOOK_COMMAND_MARKER,
  LEGACY_DOC_FILES_HOOK_COMMAND_MARKER,
  LEGACY_STOP_HOOK_COMMAND_MARKER,
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
const ADR_HOOK_LIB_DIR = 'lib'
const TEMPLATE_DIR_NAME = '.claude-template'

/** Корінь pi.dev артефактів у проєкті-споживачі. */
export const PI_DIR = '.pi'
/** Директорія pi.dev TS-extensions у проєкті-споживачі. */
export const PI_EXTENSIONS_DIR = `${PI_DIR}/extensions`
/** Назва bundled-директорії pi-template у пакеті `@7n/rules`. */
export const PI_TEMPLATE_DIR_NAME = '.pi-template'
/** Імʼя bundled pi-extension'а для ADR capture/normalize. */
export const PI_EXTENSION_NAME = 'n-rules-adr'
/** @deprecated — ім'я extension-теки до перейменування пакету; лишається для cleanup при ресинку. */
export const LEGACY_PI_EXTENSION_NAME = 'n-cursor-adr'
/** Відносний шлях до канонічного фрагмента `.gitignore` для ADR Stop-hook'ів у tarball пакета. */
export const ADR_GITIGNORE_SNIPPET_REL = '.claude-template/hooks/.gitignore.snippet'
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
 * Чи Cursor hook entry належить пакету `@7n/rules`.
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
 * @param {string[] | undefined} fromTemplate список з темплейту пакета `@7n/rules`
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
 * Зливає hooks-секцію. Для **кожної події** з обох сторін:
 *   1) видаляємо managed-групи з існуючої конфігурації (їх ідентифікують маркери з
 *      `MANAGED_HOOK_COMMAND_MARKERS`, включно з legacy-маркерами — це автоматично
 *      прибирає застарілі hook'и при переході на нову версію темплейту);
 *   2) дописуємо managed-групи з темплейту.
 * Перебір union-у подій важливий: коли пакет переносить hook між подіями (напр. `Stop`
 * → `PostToolUse`), старі managed entries у вже-непотрібній події теж мають піти.
 * @param {Record<string, HookGroup[]> | undefined} existing поточна `hooks`-секція з .claude/settings.json
 * @param {Record<string, HookGroup[]> | undefined} fromTemplate цільова `hooks`-секція з темплейту
 * @returns {Record<string, HookGroup[]>} результат злиття (порожні події видаляються)
 */
export function mergeHooks(existing, fromTemplate) {
  /** @type {Record<string, HookGroup[]>} */
  const out = {}
  const allEvents = new Set([...Object.keys(existing ?? {}), ...Object.keys(fromTemplate ?? {})])
  for (const event of allEvents) {
    const existingClean = (existing?.[event] ?? []).filter(g => !isManagedHookGroup(g))
    const templateGroups = fromTemplate?.[event] ?? []
    const combined = [...existingClean, ...templateGroups]
    if (combined.length > 0) {
      out[event] = combined
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
 * @param {ClaudeSettings} template settings із темплейту пакета `@7n/rules`
 * @param {object} [options] опції merge-у
 * @param {boolean} [options.includeAdrHook] чи додати ADR Stop-hook групу до managed-hooks (коли в `.n-rules.json` `rules` присутнє `adr`)
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
 * Копіює всі `.sh`-файли з `.claude-template/hooks/lib/` у `.claude/hooks/lib/` проєкту.
 * Файли source-only (без exec bit) — їх `source`-ять capture/normalize-decisions.sh,
 * щоб не дублювати спільну bash-логіку (`is_tooling_only_change`,
 * `git_diff_only_version_field`).
 * Тека fully-owned: при кожному sync-у перезаписується.
 * @param {string} projectRoot корінь проєкту-споживача
 * @param {string} templateDir каталог `.claude-template/` усередині пакету
 * @returns {Promise<Array<{ written: boolean, path: string }>>} перелік записаних файлів (порожній, якщо темплейту нема)
 */
export async function syncAdrHookLibScripts(projectRoot, templateDir) {
  const libTemplateDir = join(templateDir, 'hooks', ADR_HOOK_LIB_DIR)
  if (!existsSync(libTemplateDir)) {
    return []
  }
  const entries = await readdir(libTemplateDir, { withFileTypes: true })
  const libDestDir = join(projectRoot, CLAUDE_HOOKS_DIR, ADR_HOOK_LIB_DIR)
  await mkdir(libDestDir, { recursive: true })
  const written = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sh')) continue
    const content = await readFile(join(libTemplateDir, entry.name), 'utf8')
    // НЕ chmod 755 — source-файли не виконувані (їх лише `.`-ять caller-скрипти).
    await writeFile(join(libDestDir, entry.name), content, 'utf8')
    written.push({ written: true, path: `${CLAUDE_HOOKS_DIR}/${ADR_HOOK_LIB_DIR}/${entry.name}` })
  }
  return written
}

/**
 * Видаляє `.claude/hooks/lib/` директорію з проєкту-споживача.
 * Викликається коли правило `adr` вимкнено — lib-файли не самостійні, без хуків,
 * що їх source-ять, вони нікому не потрібні (симетрично до `removeOrphanPiExtension`).
 * @param {string} projectRoot корінь проєкту-споживача
 * @returns {Promise<{ removed: boolean, path: string }>} чи було щось видалено та відносний шлях
 */
export async function removeOrphanAdrHookLib(projectRoot) {
  const libDir = join(projectRoot, CLAUDE_HOOKS_DIR, ADR_HOOK_LIB_DIR)
  if (!existsSync(libDir)) {
    return { removed: false, path: '' }
  }
  await rm(libDir, { recursive: true, force: true })
  return { removed: true, path: `${CLAUDE_HOOKS_DIR}/${ADR_HOOK_LIB_DIR}` }
}

/**
 * Копіює bundled pi.dev TS-extension `npm/.pi-template/extensions/n-rules-adr/` (усі файли —
 * `index.ts`, `tsconfig.json`, потенційні `package.json`/`.gitignore` тощо) у
 * `.pi/extensions/n-rules-adr/` проєкту-споживача (legacy `n-cursor-adr/` видаляється). Тека fully-owned: при кожному sync-у
 * перезаписується. Якщо bundled template відсутній (legacy-версії пакета без `.pi-template/`)
 * або в ньому немає `index.ts` — повертаємо `{written: false}` без помилки.
 *
 * Розширення поверх `index.ts` (tsconfig тощо) потрібні, бо `.pi/extensions/` синхронізується як є
 * у проєкти-споживачі, а IDE/TS-сервер мусить резолвити `node:*` модулі без додаткових
 * project-wide конфігів.
 * @param {string} projectRoot корінь проєкту-споживача
 * @param {string} bundledPackageRoot корінь установленого `@7n/rules` (із `.pi-template/`)
 * @returns {Promise<{ written: boolean, path: string, files: string[] }>} чи писали; відносний шлях до теки розширення; список скопійованих базових імен (відсортований)
 */
export async function syncPiExtensions(projectRoot, bundledPackageRoot) {
  const srcDir = join(bundledPackageRoot, PI_TEMPLATE_DIR_NAME, 'extensions', PI_EXTENSION_NAME)
  const indexPath = join(srcDir, 'index.ts')
  if (!existsSync(indexPath)) {
    return { written: false, path: '', files: [] }
  }
  const legacyDir = join(projectRoot, PI_EXTENSIONS_DIR, LEGACY_PI_EXTENSION_NAME)
  if (existsSync(legacyDir)) {
    await rm(legacyDir, { recursive: true, force: true })
  }
  const destDir = join(projectRoot, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
  await mkdir(destDir, { recursive: true })
  const entries = await readdir(srcDir, { withFileTypes: true })
  const copied = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = entry.name
    const content = await readFile(join(srcDir, name), 'utf8')
    await writeFile(join(destDir, name), content, 'utf8')
    copied.push(name)
  }
  return {
    written: true,
    path: `${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}`,
    files: copied.toSorted((a, b) => a.localeCompare(b))
  }
}

/**
 * Видаляє `.pi/extensions/n-rules-adr/` (і legacy `n-cursor-adr/`) директорію з проєкту-споживача.
 * Викликається коли правило `adr` вимкнено у `.n-rules.json` (симетрично до
 * cleanup-у `.claude/hooks/{capture,normalize}-decisions.sh`).
 * @param {string} projectRoot корінь проєкту-споживача
 * @returns {Promise<{ removed: boolean, path: string }>} чи було щось видалено та відносний шлях
 */
export async function removeOrphanPiExtension(projectRoot) {
  const legacyDir = join(projectRoot, PI_EXTENSIONS_DIR, LEGACY_PI_EXTENSION_NAME)
  if (existsSync(legacyDir)) {
    await rm(legacyDir, { recursive: true, force: true })
  }
  const extDir = join(projectRoot, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
  if (!existsSync(extDir)) {
    return { removed: false, path: '' }
  }
  await rm(extDir, { recursive: true, force: true })
  return { removed: true, path: `${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}` }
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
 * @param {string} bundledPackageRoot корінь установленого `@7n/rules`
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

  const sectionHeader = '# @7n/rules (adr) — локальні артефакти Stop-hook, не коміти'
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
 * @param {string} templateDir каталог `.claude-template/` усередині пакету `@7n/rules`
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
 * Використовується з `bin/n-rules.js` після інших синків.
 * @param {object} options опції синку
 * @param {string} options.projectRoot корінь проєкту-споживача
 * @param {string} options.bundledPackageRoot корінь установленого `@7n/rules`
 * @param {boolean} options.enabled чи увімкнено sync (з `.n-rules.json` `claude-config`)
 * @param {string[]} [options.rules] список увімкнених правил із `.n-rules.json` — впливає на ADR Stop-hook (`adr`)
 * @returns {Promise<{ settings: boolean, cursorHooks: boolean, commands: string[], adrHook: boolean, adrNormalizeHook: boolean, adrHookLib: string[], gitignoreAdr: boolean, piExtension: boolean }>} прапорці записів settings/Cursor hooks/ADR-hook(s)/`.gitignore`/pi-extension, перелік lib-файлів і список slash-команд
 */
export async function syncClaudeConfig({ projectRoot, bundledPackageRoot, enabled, rules = [] }) {
  if (!enabled) {
    return {
      settings: false,
      cursorHooks: false,
      commands: [],
      adrHook: false,
      adrNormalizeHook: false,
      adrHookLib: [],
      gitignoreAdr: false,
      piExtension: false
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
      adrHookLib: [],
      gitignoreAdr: false,
      piExtension: false
    }
  }
  const includeAdrHook = Array.isArray(rules) && rules.includes('adr')
  const adrHook = includeAdrHook ? await syncAdrHookScript(projectRoot, templateDir) : { written: false, path: '' }
  const adrNormalizeHook = includeAdrHook
    ? await syncAdrNormalizeHookScript(projectRoot, templateDir)
    : { written: false, path: '' }
  // Lib-файли мають сенс лише з активним хоча б одним ADR-хуком — без caller'а
  // нікому source-ити; при вимкненому правилі прибираємо осиротілу-теку.
  const adrHookLibEntries = includeAdrHook
    ? await syncAdrHookLibScripts(projectRoot, templateDir)
    : (await removeOrphanAdrHookLib(projectRoot), [])
  const gitignoreAdr = includeAdrHook
    ? await syncGitignoreAdrFragment(projectRoot, bundledPackageRoot)
    : { written: false, path: '' }
  let piExtension
  if (includeAdrHook) {
    piExtension = await syncPiExtensions(projectRoot, bundledPackageRoot)
  } else {
    const removed = await removeOrphanPiExtension(projectRoot)
    piExtension = { written: false, path: removed.path }
  }
  const settings = await syncClaudeSettings(projectRoot, templateDir, { includeAdrHook })
  const cursorHooks = await syncCursorHooksConfig(projectRoot, { includeAdrHook })
  const commands = await syncClaudeCommands(projectRoot, templateDir)
  return {
    settings: settings.written,
    cursorHooks: cursorHooks.written,
    commands,
    adrHook: adrHook.written,
    adrNormalizeHook: adrNormalizeHook.written,
    adrHookLib: adrHookLibEntries.map(e => e.path),
    gitignoreAdr: gitignoreAdr.written,
    piExtension: piExtension.written
  }
}
