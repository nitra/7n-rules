/** @see ./docs/trufflehog.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { checkTextSubset } from '../../../scripts/lib/template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET_PATH = join(HERE, 'templates', 'trufflehog', '.trufflehog-exclude.snippet.txt')

/**
 * Перевіряє наявність і канонічний вміст `.trufflehog-exclude` у корені проєкту.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, репортер).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки з pass/fail.
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  if (!existsSync(join(cwd, 'package.json'))) {
    fail('package.json не знайдено в корені — додай (security.mdc)')
    return reporter.result()
  }
  pass('package.json є (структуру перевіряє Rego)')

  const trufflePath = join(cwd, '.trufflehog-exclude')
  if (!existsSync(trufflePath)) {
    fail('.trufflehog-exclude не знайдено в корені — додай за каноном (security.mdc)')
    return reporter.result()
  }

  const actual = await readFile(trufflePath, 'utf8')
  const template = await readFile(SNIPPET_PATH, 'utf8')
  const errors = checkTextSubset(actual, template, {
    targetPath: '.trufflehog-exclude',
    source: 'security.mdc'
  })
  for (const msg of errors) fail(msg)
  if (errors.length === 0) pass('.trufflehog-exclude містить канонічні patterns')

  return reporter.result()
}
