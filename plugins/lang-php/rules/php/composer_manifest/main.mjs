/**
 * lint-поверхня php/composer_manifest: канон кореневого `composer.json` (у дусі
 * `npm-module` для `package.json`). Read-only detector, `full`-scope. Декларативні
 * перевірки (JSON-парсинг, `config.sort-packages`, `license`, `require.php`) працюють
 * завжди — навіть без встановленого `composer`; `composer validate --strict
 * --no-check-publish` — лише якщо `composer` є в PATH (відсутність — тихий skip,
 * `composer-missing` як окрему причину порушення репортить `php/project`).
 * @see ./docs/main.md
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/** Значення `require.php`, що формально присутнє, але не є явним обмеженням версії. */
const NON_EXPLICIT_PHP_CONSTRAINTS = new Set(['*', ''])

/**
 * Перевіряє канон сортування залежностей: `config.sort-packages` має бути `true`.
 * @param {Record<string, unknown>} manifest розпарсений composer.json
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення
 */
function checkSortPackages(manifest, fail) {
  const config = /** @type {Record<string, unknown> | undefined} */ (manifest.config)
  if (config && typeof config === 'object' && config['sort-packages'] === true) return
  fail(
    'lint-php: composer.json — config.sort-packages не увімкнено; виконай `composer config sort-packages true` ' +
      '(composer_manifest.mdc)',
    'composer-manifest-sort-packages'
  )
}

/**
 * Перевіряє наявність поля `license` (рядок або масив ідентифікаторів SPDX).
 * @param {Record<string, unknown>} manifest розпарсений composer.json
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення
 */
function checkLicense(manifest, fail) {
  const { license } = manifest
  const hasLicense =
    (typeof license === 'string' && license.trim().length > 0) || (Array.isArray(license) && license.length > 0)
  if (hasLicense) return
  fail(
    'lint-php: composer.json — поле "license" відсутнє або порожнє; додай SPDX-ідентифікатор ' +
      '(наприклад "MIT" чи "proprietary") (composer_manifest.mdc)',
    'composer-manifest-license-missing'
  )
}

/**
 * Перевіряє явний version-constraint для `require.php`.
 * @param {Record<string, unknown>} manifest розпарсений composer.json
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення
 */
function checkPhpConstraint(manifest, fail) {
  const require_ = /** @type {Record<string, unknown> | undefined} */ (manifest.require)
  const constraint = require_ && typeof require_ === 'object' ? require_.php : undefined
  if (
    typeof constraint === 'string' &&
    constraint.trim().length > 0 &&
    !NON_EXPLICIT_PHP_CONSTRAINTS.has(constraint.trim())
  ) {
    return
  }
  fail(
    'lint-php: composer.json — "require.php" без явного version-constraint; додай, наприклад, ' +
      '`"php": ">=8.5"` у секцію "require" (composer_manifest.mdc)',
    'composer-manifest-php-constraint-missing'
  )
}

/**
 * Detector php/composer_manifest (read-only). Async — `spawnAsync` для `composer validate`
 * може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd
  const manifestPath = join(root, 'composer.json')

  if (!existsSync(manifestPath)) return reporter.result()

  const raw = await readFile(manifestPath, 'utf8')
  /** @type {Record<string, unknown>} */
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(
      `lint-php: composer.json — невалідний JSON (${detail}); виправ синтаксис (composer_manifest.mdc)`,
      'composer-manifest-invalid-json'
    )
    return reporter.result()
  }

  checkSortPackages(manifest, fail)
  checkLicense(manifest, fail)
  checkPhpConstraint(manifest, fail)

  const composer = resolveCmd('composer')
  if (composer) {
    const r = await spawnAsync(composer, ['validate', '--strict', '--no-check-publish'], { cwd: root })
    if (r.exitCode !== 0) {
      const code = typeof r.exitCode === 'number' ? r.exitCode : 1
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
      const outSuffix = out ? `\n${out}` : ''
      fail(
        `lint-php: composer validate --strict — помилка (код ${code}, composer_manifest.mdc)${outSuffix}`,
        'composer-manifest-validate-failed'
      )
    }
  }
  // composer відсутній у PATH → тихий skip: composer-missing репортить php/project.

  return reporter.result()
}
