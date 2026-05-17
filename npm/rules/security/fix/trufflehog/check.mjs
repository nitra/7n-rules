/**
 * FS-частина правила `security`.
 *
 * Перевіряє:
 *  - наявність `package.json` (структуру валідує policy security.package_json);
 *  - наявність `.trufflehog-exclude` у корені та subset канонічних patterns
 *    (text-subset, бо `.trufflehog-exclude` — plain text, не структурований).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { checkTextSubset } from '../../../../scripts/utils/template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET_PATH = join(HERE, 'template', '.trufflehog-exclude.snippet.txt')

export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (security.mdc)')
    return reporter.getExitCode()
  }
  pass('package.json є (структуру перевіряє Rego)')

  if (!existsSync('.trufflehog-exclude')) {
    fail('.trufflehog-exclude не знайдено в корені — додай за каноном (security.mdc)')
    return reporter.getExitCode()
  }

  const actual = await readFile('.trufflehog-exclude', 'utf8')
  const template = await readFile(SNIPPET_PATH, 'utf8')
  const errors = checkTextSubset(actual, template, {
    targetPath: '.trufflehog-exclude',
    source: 'security.mdc'
  })
  for (const msg of errors) fail(msg)
  if (errors.length === 0) pass('.trufflehog-exclude містить канонічні patterns')

  return reporter.getExitCode()
}
