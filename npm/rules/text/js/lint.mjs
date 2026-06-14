/**
 * Крок text: делегує у наявний CLI правила (per-file режиму немає — `files` ігнорується).
 */
import { runLintTextCli } from '../lint/lint.mjs'

/**
 * @param {string[] | undefined} _files ігнорується (whole-repo аналіз)
 * @param {string} [_cwd] корінь (ігнорується — CLI працює від process.cwd())
 * @param {{ readOnly?: boolean }} [opts] readOnly → детект без авто-фіксу (нуль мутацій)
 * @returns {Promise<number>} exit code
 */
export function lint(_files, _cwd, opts = {}) {
  return runLintTextCli({ readOnly: opts.readOnly === true })
}
