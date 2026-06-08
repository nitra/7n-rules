/**
 * Ci-крок ga: делегує у наявний CLI правила (per-file режиму немає — `files` ігнорується).
 */
import { runLintGaCli } from '../lint/lint.mjs'

/**
 * @param {string[] | undefined} _files ігнорується (whole-repo аналіз)
 * @returns {Promise<number>} exit code
 */
export function lint(_files) {
  return runLintGaCli()
}
