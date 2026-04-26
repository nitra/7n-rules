/**
 * Перевіряє вимоги правила php.mdc для PHP-проєктів.
 *
 * Очікування:
 * - у корені є `composer.json`;
 * - у `package.json` є скрипт `lint-php` (рекомендовано делегувати в `run-php.mjs`);
 * - у `.github/workflows/lint-php.yml` є крок `run: bun run lint-php` (для Bun-репозиторіїв).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'
import { anyRunStepIncludes, parseWorkflowYaml } from './utils/gha-workflow.mjs'

/**
 * Перевіряє наявність `composer.json`.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 */
function checkComposer(reporter) {
  const { pass, fail } = reporter
  if (existsSync('composer.json')) {
    pass('composer.json існує')
  } else {
    fail('composer.json не знайдено в корені — додай (php.mdc)')
  }
}

/**
 * Перевіряє кореневий `package.json` на скрипт `lint-php`.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 */
async function checkPackageJson(reporter) {
  const { pass, fail } = reporter
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (php.mdc)')
    return
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const lintPhp = pkg.scripts?.['lint-php']
  if (lintPhp) {
    pass('package.json містить скрипт lint-php')
  } else {
    fail('package.json: додай скрипт "lint-php" (php.mdc)')
  }
}

/**
 * Перевіряє workflow `lint-php.yml`.
 * @param {import('./utils/check-reporter.mjs').CheckReporter} reporter репортер для збору результатів
 */
async function checkWorkflow(reporter) {
  const { pass, fail } = reporter
  const wfPath = '.github/workflows/lint-php.yml'
  if (!existsSync(wfPath)) {
    fail(`${wfPath} не існує — створи згідно php.mdc`)
    return
  }
  const content = await readFile(wfPath, 'utf8')
  pass('lint-php.yml існує')
  const root = parseWorkflowYaml(content)
  const ok = root ? anyRunStepIncludes(root, 'bun run lint-php') : content.includes('bun run lint-php')
  if (ok) {
    pass('lint-php.yml викликає bun run lint-php')
  } else {
    fail('lint-php.yml має містити крок run: bun run lint-php (php.mdc)')
  }
}

/**
 * Перевіряє відповідність проєкту правилам php.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  checkComposer(reporter)
  await checkPackageJson(reporter)
  await checkWorkflow(reporter)
  return reporter.getExitCode()
}

