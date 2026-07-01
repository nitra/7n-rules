/**
 * Thin hook entrypoint для Claude Code hooks: зчитує контекст (stdin / git),
 * делегує в `detectAll` (read-only), перекодовує exit-код у hook-протокол (1 → 2).
 *
 * Режими:
 *   --post-tool-use  PostToolUse: file_path зі stdin JSON Claude Code.
 *   --stop           Stop: робоче дерево vs HEAD (`git diff HEAD` + untracked).
 */
import { once } from 'node:events'
import { cwd as processCwd } from 'node:process'

import { detectAll } from './lib/lint-surface/run-detectors.mjs'
import { collectChangedFiles } from './lib/changed-files.mjs'

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
 * @returns {string|null}
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
 * CLI для `n-cursor hook`.
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
    const { exitCode } = await detectAll({ files: [fp], cwd })
    return exitCode === 0 ? 0 : 2
  }

  const files = collectChangedFiles(cwd)
  const { exitCode } = await detectAll({ files, cwd })
  return exitCode === 0 ? 0 : 2
}
