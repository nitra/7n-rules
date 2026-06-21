/** @see ./docs/lint.md */
import { run } from '../lint/lint.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

/**
 * Оркестраторний адаптер `n-cursor lint php` (лінтер-фаза): composer audit + php-cs-fixer
 * (`--dry-run`) + phpstan/psalm через `run` (read-only — мутацій немає, тож `opts` ігнорується).
 * Структурні php.mdc-перевірки — у конформність-фазі. Без composer-інструментів крок — no-op.
 * @param {string[] | undefined} _files ігнорується (whole-repo обхід)
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd()) {
  return runStandardLint(import.meta.dirname, () => run(cwd))
}
