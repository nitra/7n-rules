/**
 * Thin hook entrypoint для Claude Code / Cursor / Codex CLI hooks: зчитує контекст
 * (stdin / git), делегує в `detectAll` (read-only), перекодовує exit-код у hook-протокол (1 → 2).
 *
 * Режими:
 *   --post-tool-use  PostToolUse: шлях(и) зміненого файлу зі stdin JSON — Claude Code
 *                     (`tool_input.file_path`, один файл) або Codex CLI (`tool_name: "apply_patch"`,
 *                     `tool_input.command` — V4A-патч `*** Begin Patch ... *** End Patch`, можливо
 *                     кілька файлів; джерело формату: openai/codex apply_patch_tool_instructions.md).
 *                     NB: покриття PostToolUse для `apply_patch` у Codex CLI станом на час написання
 *                     задокументовано суперечливо (відкритий issue openai/codex#16732 — "ApplyPatchHandler
 *                     doesn't emit PreToolUse/PostToolUse hook event") — на частині версій подія може
 *                     не спрацювати взагалі; Stop-hook нижче лишається надійним fallback.
 *   --stop           Stop: робоче дерево vs HEAD (`git diff HEAD` + untracked) — payload-незалежний,
 *                     працює однаково для Claude Code, Cursor і Codex CLI.
 */
import { once } from 'node:events'
import { relative, resolve } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { detectAll } from './lib/lint-surface/run-detectors.mjs'
import { collectChangedFiles } from './lib/changed-files.mjs'

const RE_BACKSLASH = /\\/gu

/**
 * Абсолютний або відносний `file_path` від Claude Code → posix-relative до `cwd`, як і
 * решта `ctx.files` (контракт `collectChangedFiles`). Без цього конкретні детектори
 * (напр. `text/run-v8r`), що спавнять зовнішні тули, отримують абсолютний шлях і падають
 * (`ignore`-залежність v8r вимагає `path.relative()`d pathname).
 * @param {string} fp сирий `file_path` зі stdin
 * @param {string} cwd корінь репо
 * @returns {string} posix-шлях відносно cwd
 */
function toRelativePosix(fp, cwd) {
  return relative(cwd, resolve(cwd, fp)).replace(RE_BACKSLASH, '/')
}

/**
 * @returns {Promise<string>} вміст stdin або '' на TTY
 */
async function readStdin() {
  if (process.stdin.isTTY) return ''
  process.stdin.setEncoding('utf8')
  const chunks = []
  process.stdin.on('data', c => {
    chunks.push(c)
  })
  try {
    await once(process.stdin, 'end')
  } catch {
    // error на stdin — повертаємо що встигли
  }
  return chunks.join('')
}

const V4A_ADD_FILE_RE = /^\*\*\* Add File: (.+)$/u
const V4A_UPDATE_FILE_RE = /^\*\*\* Update File: (.+)$/u
const V4A_MOVE_TO_RE = /^\*\*\* Move to: (.+)$/u
const EOL_RE = /\r?\n/u

/**
 * Дістає шляхи файлів з V4A-патча Codex CLI apply_patch (`*** Begin Patch ... *** End Patch`).
 * `Update File` з наступним рядком `Move to` рахує лише фінальний (перейменований) шлях;
 * `Delete File` пропускається — файла більше нема, лінтити нічого.
 * @param {string} patch сирий текст патча з `tool_input.command`
 * @returns {string[]} шляхи файлів для лінту (може бути порожньо — патч лише видаляє файли)
 */
export function extractCodexPatchPaths(patch) {
  const lines = patch.split(EOL_RE)
  const paths = []
  for (let i = 0; i < lines.length; i++) {
    const addMatch = V4A_ADD_FILE_RE.exec(lines[i])
    if (addMatch) {
      paths.push(addMatch[1].trim())
      continue
    }
    const updateMatch = V4A_UPDATE_FILE_RE.exec(lines[i])
    if (updateMatch) {
      const moveMatch = V4A_MOVE_TO_RE.exec(lines[i + 1] ?? '')
      paths.push((moveMatch ? moveMatch[1] : updateMatch[1]).trim())
    }
  }
  return paths
}

/**
 * Дістає шлях(и) зміненого файлу зі stdin JSON PostToolUse hook — Claude Code
 * (`tool_input.file_path`, один файл) або Codex CLI (`tool_name: "apply_patch"`,
 * `tool_input.command` — V4A-патч, можливо кілька файлів). Інші інструменти (Bash/Shell тощо)
 * не мають жодного з цих полів — повертає порожній масив (нема що лінтити).
 * @param {string} json сирий stdin
 * @returns {string[]} шляхи файлів (порожньо — невалідний JSON, не file-edit tool, або лише видалення)
 */
export function extractFilePaths(json) {
  if (!json) return []
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  const fp = parsed?.tool_input?.file_path
  if (typeof fp === 'string' && fp !== '') return [fp]
  if (parsed?.tool_name === 'apply_patch' && typeof parsed?.tool_input?.command === 'string') {
    return extractCodexPatchPaths(parsed.tool_input.command)
  }
  return []
}

/**
 * Claude Code при exit 2 показує агенту лише stderr (stdout hook-протоколом ігнорується),
 * тож звіт про порушення мусить іти саме туди — інакше агент бачить «blocking error»
 * без жодного пояснення, що саме заблокувало tool-виклик.
 * @param {string} s фрагмент звіту
 * @returns {void} результат
 */
function logToStderr(s) {
  process.stderr.write(s)
}

/**
 * CLI для `n-rules hook`.
 * @param {string[]} argv аргументи після 'hook'
 * @returns {Promise<number>} exit-код (0 — чисто; 2 — є порушення hook-протокол)
 */
export async function runHookCli(argv) {
  const cwd = processCwd()
  const postToolUse = argv.includes('--post-tool-use')
  const stop = argv.includes('--stop')

  if (!postToolUse && !stop) {
    process.stderr.write('hook: потрібен --post-tool-use або --stop\n')
    return 1
  }

  if (postToolUse) {
    const paths = extractFilePaths(await readStdin())
    if (paths.length === 0) return 0
    const files = paths.map(fp => toRelativePosix(fp, cwd))
    const { exitCode } = await detectAll({ files, cwd, log: logToStderr })
    return exitCode === 0 ? 0 : 2
  }

  const files = collectChangedFiles(cwd)
  const { exitCode } = await detectAll({ files, cwd, log: logToStderr })
  return exitCode === 0 ? 0 : 2
}
