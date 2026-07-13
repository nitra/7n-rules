/**
 * Thin hook entrypoint для Claude Code hooks: зчитує контекст (stdin / git),
 * делегує в `detectAll` (read-only), перекодовує exit-код у hook-протокол (1 → 2).
 *
 * Режими:
 *   --post-tool-use  PostToolUse: file_path зі stdin JSON Claude Code.
 *   --stop           Stop: робоче дерево vs HEAD (`git diff HEAD` + untracked).
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

/**
 * Дістає `tool_input.file_path` зі stdin JSON Claude Code PostToolUse hook.
 * @param {string} json сирий stdin
 * @returns {string|null} шлях до файлу або null, якщо відсутній/невалідний JSON
 */
export function extractFilePath(json) {
  if (!json) return null
  try {
    const fp = JSON.parse(json)?.tool_input?.file_path
    return typeof fp === 'string' && fp !== '' ? fp : null
  } catch {
    return null
  }
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
    const fp = extractFilePath(await readStdin())
    if (!fp) return 0
    const { exitCode } = await detectAll({ files: [toRelativePosix(fp, cwd)], cwd, log: logToStderr })
    return exitCode === 0 ? 0 : 2
  }

  const files = collectChangedFiles(cwd)
  const { exitCode } = await detectAll({ files, cwd, log: logToStderr })
  return exitCode === 0 ? 0 : 2
}
