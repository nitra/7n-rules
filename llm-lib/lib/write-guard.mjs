/** @see ./docs/write-guard.md */

/**
 * Write-safety guard для pi-agent fix-engine (§12 спеки pi-migration).
 *
 * Рішення §1 «патч застосовує агент» забирає dry-run, тому контроль над записом
 * виносимо у три незалежні під-механізми, що спираються на одну git-precondition:
 *   - **Scope/Denylist** — превентивний veto через `pi.on('tool_call')`: блок запису
 *     поза git-root, під `.git/`, або в будь-що, що матчить `git check-ignore`.
 *   - **Snapshot** — per-file pre-image (наявний вміст або позначка NEW) на перший
 *     дотик; покриває abort посеред запису.
 *   - **Rollback** — відновлення pre-image (або видалення NEW-файлів) на провал verdict-а.
 *
 * ⚠️ Розводка: фабрику передавати ВИКЛЮЧНО через `new DefaultResourceLoader({
 * extensionFactories: [factory] })` → `resourceLoader`. Top-level
 * `createAgentSession({ extensionFactories })` **мовчки ігнорується** (Спайк 3,
 * fail-open). Тому caller ОБОВ'ЯЗКОВО перевіряє `state.attached` (fail-closed canary)
 * перед `session.prompt` і скасовує fix, якщо guard не приєднався.
 *
 * Pi-free: фабрика лише shape-сумісна з ExtensionAPI (`pi.on`), імпортів pi нема.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Sentinel pre-image для файлу, якого до запису не існувало (rollback = видалити). */
export const NEW_FILE = Symbol('new-file')

/** Tool-и, що пишуть на диск і підлягають veto. */
const WRITE_TOOLS = new Set(['edit', 'write'])

/**
 * git-root для cwd (`git rev-parse --show-toplevel`) або null, якщо не git-репо.
 * Fix-шлях вимагає git → caller на null **пропускає fix** (§12 precondition).
 * @param {string} cwd робоча директорія
 * @returns {string|null} абсолютний git-root або null
 */
export function gitRoot(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return null
  return r.stdout.trim() || null
}

/**
 * realpath шляху з найкращих зусиль: для наявного — повний realpath; для ще-неіснуючого
 * (NEW-файл) — realpath батьківської теки + basename; інакше — як є. Знімає розбіжність
 * symlink-шляхів (macOS `/tmp` → `/private/tmp`), через яку tracked-файл хибно блокувався.
 * @param {string} p шлях
 * @returns {string} нормалізований абсолютний шлях
 */
function realpathBestEffort(p) {
  try {
    return realpathSync(p)
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p))
    } catch {
      return p
    }
  }
}

/**
 * Чи `abs` під `root` (захист від `..`-escape).
 * @param {string} root корінь-каталог.
 * @param {string} abs абсолютний шлях, що перевіряється.
 * @returns {boolean} true, якщо `abs` лежить під `root`.
 */
function isUnder(root, abs) {
  const rel = relative(root, abs)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Чи `abs` ігнорований git'ом (`git check-ignore -q`, exit 0 = ignored).
 * @param {string} root git-корінь, у якому запускається `git check-ignore`.
 * @param {string} abs абсолютний шлях, що перевіряється.
 * @returns {boolean} true, якщо шлях git-ignored.
 */
function isIgnored(root, abs) {
  return spawnSync('git', ['check-ignore', '-q', '--', abs], { cwd: root }).status === 0
}

/**
 * Створює write-guard для однієї fix-сесії.
 * @param {{ cwd: string, root?: string|null, checkIgnore?: (root: string, abs: string) => boolean }} opts
 *   cwd — робоча директорія; root — git-root (за替замовч. обчислюється); checkIgnore — інжекція для тестів
 * @returns {{
 *   factory: (pi: { on: (event: string, handler: (event: object) => void) => void }) => void,
 *   state: { attached: boolean, root: string|null, preImages: Map<string, string|symbol>, blocks: Array<{path:string,reason:string}> },
 *   rollback: () => void,
 *   touchedFiles: () => string[]
 * }} guard
 */
export function createWriteGuard({ cwd, root, checkIgnore = isIgnored, onCapture }) {
  const rawRoot = root === undefined ? gitRoot(cwd) : root
  const gitRootDir = rawRoot ? realpathBestEffort(rawRoot) : rawRoot
  // editLog — повні правки агента (oldText/newText / content) для телеметрії §7.
  const state = { attached: false, root: gitRootDir, preImages: new Map(), blocks: [], editLog: [] }

  const factory = pi => {
    state.attached = true
    // Синхронний хендлер: уся робота (spawnSync/fs) синхронна; pi коректно
    // awaitить і не-Promise return (Спайк 3). Так veto детерміновано тестується.
    pi.on('tool_call', event => {
      if (!WRITE_TOOLS.has(event?.toolName)) return
      const raw = event?.input?.path
      if (typeof raw !== 'string' || raw === '') return // не резолвимо — хай pi сам

      // realpath-нормалізація: edit-шлях агента може бути symlink-варіантом root'а.
      const abs = realpathBestEffort(isAbsolute(raw) ? raw : resolve(cwd, raw))
      const block = reason => {
        state.blocks.push({ path: abs, reason })
        return { block: true, reason }
      }

      // 1. Scope: під git-root.
      if (!gitRootDir || !isUnder(gitRootDir, abs)) return block(`запис поза git-root: ${raw}`)
      // 2. .git/ (поза моделлю ignore).
      const rel = relative(gitRootDir, abs)
      if (rel === '.git' || rel.startsWith(`.git${sep}`)) return block(`запис у .git/ заблоковано: ${raw}`)
      // 3. Denylist = git-ignored (build-артефакти, node_modules, .env, .worktrees…).
      if (checkIgnore(gitRootDir, abs)) return block(`запис у git-ignored заблоковано: ${raw}`)

      // 4. Allow + Snapshot pre-image на перший дотик + лог правки (телеметрія §7).
      if (!state.preImages.has(abs)) {
        state.preImages.set(abs, existsSync(abs) ? readFileSync(abs, 'utf8') : NEW_FILE)
        // Bridge у central rollback unified lint surface: записати pre-image ДО запису.
        onCapture?.(abs)
      }
      state.editLog.push({
        path: abs,
        tool: event.toolName,
        edits: event.input?.edits ?? null, // edit: [{oldText,newText}]
        content: event.input?.content ?? null // write: повний вміст
      })
    })
  }

  /** Відновлює pre-image усіх зачеплених файлів (NEW → видалити). */
  function rollback() {
    for (const [abs, pre] of state.preImages) {
      if (pre === NEW_FILE) {
        if (existsSync(abs)) rmSync(abs)
      } else {
        writeFileSync(abs, pre)
      }
    }
  }

  /**
   * Список абсолютних шляхів, яких агент торкнувся (для scoped re-check verdict §4+5).
   * @returns {string[]} масив абсолютних шляхів зачеплених файлів.
   */
  function touchedFiles() {
    return state.preImages.keys().toArray()
  }

  return { factory, state, rollback, touchedFiles }
}
