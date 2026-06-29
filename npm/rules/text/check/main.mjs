/**
 * lint-поверхня text: cspell/shellcheck/dotenv-linter/markdownlint/v8r (read-only detector).
 */
import { main as markdownlintCli2 } from 'markdownlint-cli2'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { runCspellText } from '../cspell-fix/main.mjs'
import { runDotenvLinter } from '../run-dotenv-linter/main.mjs'
import { runShellcheckText } from '../run-shellcheck/main.mjs'
import { runV8rWithGlobs } from '../run-v8r/main.mjs'

/**
 * Detector text: read-only прогін cspell/shellcheck/dotenv-linter/markdownlint/v8r.
 * Кожен крок read-only; failing крок → одна violation. Fix (cspell LLM, shellcheck/dotenv
 * auto-fix, markdownlint --fix) — окремий fix-worker, не тут.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  ensureTool('shellcheck')
  ensureTool('dotenv-linter')

  /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []
  /** @param {string} reason @param {string} message */
  const add = (reason, message) => violations.push(/** @type {any} */ ({ reason, message }))

  if ((await runCspellText(cwd, true, false)) !== 0) add('cspell', 'cspell знайшов порушення правопису (text.mdc)')
  if (runShellcheckText(cwd, true) !== 0) add('shellcheck', 'shellcheck знайшов порушення у *.sh (text.mdc)')
  if (runDotenvLinter(cwd, true) !== 0) add('dotenv-linter', 'dotenv-linter знайшов порушення у .env* (text.mdc)')

  const markdownlintCode = await markdownlintCli2({
    directory: cwd,
    argv: ['**/*.md', '**/*.mdc'],
    logMessage: () => {},
    logError: () => {}
  })
  if (markdownlintCode !== 0) add('markdownlint', 'markdownlint знайшов порушення у *.md/*.mdc (text.mdc)')

  if (runV8rWithGlobs() !== 0) add('v8r', 'v8r schema-валідація json/yaml/toml не пройшла (text.mdc)')

  return { violations }
}
