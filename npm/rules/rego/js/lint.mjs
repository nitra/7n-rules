/**
 * Ci-крок rego: делегує у наявний CLI правила (per-file режиму немає — `files` ігнорується).
 */
import { runLintRego } from '../lint/lint.mjs'

/**
 * @param {string[] | undefined} _files ігнорується (whole-repo аналіз)
 * @returns {Promise<number>} exit code
 */
export async function lint(_files) {
  return runLintRego()
}
