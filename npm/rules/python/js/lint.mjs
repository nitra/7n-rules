/** @see ./docs/lint.md */
import { runLintPython } from '../lint/lint.mjs'

/**
 * Ci-крок python: делегує у наявний CLI правила (per-file режиму немає — `files` ігнорується;
 * uv/ruff/mypy працюють по всьому проєкту). Без `pyproject.toml` крок — no-op (exit 0).
 * @param {string[] | undefined} _files ігнорується (whole-project аналіз)
 * @param {string} [_cwd] корінь (CLI бере process.cwd())
 * @param {{ readOnly?: boolean }} [opts] readOnly → ruff без `--fix`, format `--check` (нуль мутацій)
 * @returns {Promise<number>} exit code
 */
export function lint(_files, _cwd, opts = {}) {
  return runLintPython({ readOnly: opts.readOnly === true })
}
