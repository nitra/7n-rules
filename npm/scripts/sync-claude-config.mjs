/**
 * Синхронізує конфігурацію Claude Code (`.claude/settings.json`, `npm/CLAUDE.md`,
 * slash-команди для checks) у поточний проєкт із темплейтів пакету
 * `npm/.claude-template/`.
 *
 * Архітектура:
 * - `settings.json` — **merge**: користувацькі поля зберігаються; наші hooks
 *   ідентифікуються командою-маркером (`MANAGED_HOOK_COMMAND_MARKER`) і
 *   перезаписуються; permissions.allow зливається через union (із дедублікацією).
 * - `npm/CLAUDE.md` — **fully owned**: завжди перезаписується; пропускається,
 *   якщо в проєкті немає каталогу `npm/`.
 * - `.claude/commands/n-check.md` — fully owned slash-команда.
 *
 * Опт-аут — `claude-config: false` у `.n-cursor.json`.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Маркер у command нашого managed-hook'а — за ним відрізняємо свої записи від користувацьких */
export const MANAGED_HOOK_COMMAND_MARKER = '@nitra/cursor stop-hook'

const CLAUDE_DIR = '.claude'
const CLAUDE_SETTINGS_FILE = `${CLAUDE_DIR}/settings.json`
const CLAUDE_COMMANDS_DIR = `${CLAUDE_DIR}/commands`
const NPM_CLAUDE_MD_FILE = 'npm/CLAUDE.md'
const TEMPLATE_DIR_NAME = '.claude-template'

/**
 * @typedef {object} HookEntry
 * @property {string} type
 * @property {string} command
 * @property {number} [timeout]
 */

/**
 * @typedef {object} HookGroup
 * @property {string} [matcher]
 * @property {HookEntry[]} hooks
 */

/**
 * @typedef {object} ClaudeSettings
 * @property {{ allow?: string[] }} [permissions]
 * @property {Record<string, HookGroup[]>} [hooks]
 */

/**
 * Чи hook-група містить лише наші managed-команди (за маркером).
 * @param {HookGroup} group
 * @returns {boolean}
 */
function isManagedHookGroup(group) {
  if (!group?.hooks?.length) {
    return false
  }
  return group.hooks.every(h => typeof h?.command === 'string' && h.command.includes(MANAGED_HOOK_COMMAND_MARKER))
}

/**
 * Зливає список allow-permissions: union існуючого і темплейтного без дублікатів,
 * порядок — спочатку існуючі (щоб не міняти користувацький порядок), потім нові.
 * @param {string[] | undefined} existing
 * @param {string[] | undefined} fromTemplate
 * @returns {string[]}
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
 * @param {Record<string, HookGroup[]> | undefined} existing
 * @param {Record<string, HookGroup[]> | undefined} fromTemplate
 * @returns {Record<string, HookGroup[]>}
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
 * Повертає об'єднаний об'єкт settings.json.
 * @param {ClaudeSettings | undefined} existing
 * @param {ClaudeSettings} template
 * @returns {ClaudeSettings}
 */
export function mergeSettings(existing, template) {
  /** @type {ClaudeSettings} */
  const merged = { ...existing }
  const mergedAllow = mergeAllowList(existing?.permissions?.allow, template.permissions?.allow)
  if (mergedAllow.length > 0) {
    merged.permissions = { ...existing?.permissions, allow: mergedAllow }
  }
  const mergedHooks = mergeHooks(existing?.hooks, template.hooks)
  if (Object.keys(mergedHooks).length > 0) {
    merged.hooks = mergedHooks
  } else {
    delete merged.hooks
  }
  return merged
}

/**
 * Читає JSON-файл; якщо файл відсутній або не валідний — повертає `undefined`.
 * @param {string} path
 * @returns {Promise<ClaudeSettings | undefined>}
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
 * @returns {Promise<{ written: boolean, path: string }>}
 */
export async function syncClaudeSettings(projectRoot, templateDir) {
  const templatePath = join(templateDir, 'settings.template.json')
  if (!existsSync(templatePath)) {
    return { written: false, path: '' }
  }
  const template = /** @type {ClaudeSettings} */ (JSON.parse(await readFile(templatePath, 'utf8')))
  const settingsPath = join(projectRoot, CLAUDE_SETTINGS_FILE)
  const existing = await readJsonOrUndefined(settingsPath)
  const merged = mergeSettings(existing, template)
  await mkdir(join(projectRoot, CLAUDE_DIR), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  return { written: true, path: CLAUDE_SETTINGS_FILE }
}

/**
 * Копіює `npm/CLAUDE.md` з темплейту, якщо в проєкті є каталог `npm/`.
 * @param {string} projectRoot
 * @param {string} templateDir
 * @returns {Promise<{ written: boolean, path: string }>}
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
 * @param {string} projectRoot
 * @param {string} templateDir
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
 * @param {object} options
 * @param {string} options.projectRoot корінь проєкту-споживача
 * @param {string} options.bundledPackageRoot корінь установленого `@nitra/cursor`
 * @param {boolean} options.enabled чи увімкнено sync (з `.n-cursor.json` `claude-config`)
 * @returns {Promise<{ settings: boolean, npmClaudeMd: boolean, commands: string[] }>}
 */
export async function syncClaudeConfig({ projectRoot, bundledPackageRoot, enabled }) {
  if (!enabled) {
    return { settings: false, npmClaudeMd: false, commands: [] }
  }
  const templateDir = join(bundledPackageRoot, TEMPLATE_DIR_NAME)
  if (!existsSync(templateDir)) {
    return { settings: false, npmClaudeMd: false, commands: [] }
  }
  const settings = await syncClaudeSettings(projectRoot, templateDir)
  const npmClaudeMd = await syncNpmClaudeMd(projectRoot, templateDir)
  const commands = await syncClaudeCommands(projectRoot, templateDir)
  return { settings: settings.written, npmClaudeMd: npmClaudeMd.written, commands }
}
