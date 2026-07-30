/**
 * lint-поверхня php/project: read-only detector (`composer audit` + `mago analyze`),
 * перейменовано з колишнього bundled `php/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). PHPStan/Psalm замінено
 * на `mago analyze` (spec `docs/specs/2026-07-30-mago-php-toolchain.md`) — `composer audit`
 * лишається обов'язковим байт-у-байт як раніше. `full`, без `lint.glob` — mago analyze
 * потребує повного project-graph (autoload, class hierarchy), запуск на одному файлі дає
 * неповний/хибний результат; composer audit — project-wide dependency audit. Не входять у
 * delta-план (§5): спрацьовують лише через `n-rules lint --full` або scoped `n-rules lint php`.
 *
 * Nested Composer workspaces (ADR `2026-07-27-nested-composer-workspace-detection`): цей
 * детектор свідомо читає лише кореневий `composer.json` (`ctx.cwd`) — вкладені Composer-проєкти
 * (`services/api/composer.json`) активують правило `php` (auto.glob до глибини 2), і кожен
 * `.php`-файл лінтиться per-file концернами `mago_fmt`/`mago_lint` незалежно від того, під яким
 * вкладеним composer.json він лежить, але НЕ проганяються тут через `composer audit`/`mago
 * analyze`. Деталі й обґрунтування — `docs/adr/`, `tooling/tooling.mdc`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureToolAsync } from '@7n/rules/scripts/lib/ensure-tool.mjs'
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/**
 * Перший `X.Y`-патерн у composer-constraint (`">=8.2"`, `"^8.2"`, `"~8.2.0"`, `"8.2.*"`).
 * Обмежені квантифікатори (`{1,4}`, не `+`) — уникає sonarjs/super-linear-regex heuristic-и на
 * послідовних unbounded-групах; PHP-версії ніколи не мають більше 4 цифр у компоненті.
 */
const PHP_VERSION_RE = /(\d{1,4})\.(\d{1,4})/

/**
 * Витягує мінімальну PHP-версію (наприклад `"8.2"`) з composer-constraint `require.php` для
 * `mago --php-version` (`mago analyze` перевіряє синтаксис/типи під конкретну версію PHP,
 * а не сканує весь діапазон constraint-у). Composer-синтаксис constraint-ів (caret/tilde/OR-range)
 * не парситься повністю — береться перше число-в-числі у рядку, що покриває типові форми
 * (`>=8.2`, `^8.2`, `~8.2.0`, `8.2.*`); складніші вирази (OR-range `"8.1 || 8.2"`) дадуть перше
 * знайдене число, що є прийнятним наближенням «мінімальної підтримуваної версії».
 * @param {unknown} constraint значення `require.php` з composer.json
 * @returns {string | null} `"X.Y"` або null, якщо не вдалось розпізнати/constraint відсутній
 */
export function extractPhpVersion(constraint) {
  if (typeof constraint !== 'string') return null
  const m = PHP_VERSION_RE.exec(constraint)
  return m ? `${m[1]}.${m[2]}` : null
}

/**
 * Читає `require.php` з кореневого composer.json. Тихо повертає null на будь-яку помилку
 * (відсутній файл, битий JSON, відсутнє поле) — `mago analyze` тоді запускається без
 * `--php-version` (дефолт mago/`mago.toml`); синтаксична валідність composer.json — turf
 * `composer_manifest` (`composer-manifest-invalid-json`), не цього детектора.
 * @param {string} manifestPath абсолютний шлях до composer.json
 * @returns {Promise<string | null>} `"X.Y"` або null
 */
async function readPhpVersionConstraint(manifestPath) {
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const manifest = /** @type {Record<string, unknown>} */ (JSON.parse(raw))
    const require_ = /** @type {Record<string, unknown> | undefined} */ (manifest.require)
    return extractPhpVersion(require_?.php)
  } catch {
    return null
  }
}

/**
 * Запускає тул і, на ненульовий код, реєструє порушення. Async (не блокує event loop) —
 * детектор може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {string} label назва кроку
 * @param {string} abs абсолютний шлях
 * @param {string[]} args аргументи команди.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {Promise<boolean>} true якщо OK, false якщо порушення
 */
async function runTool(label, abs, args, cwd, fail, reason) {
  const r = await spawnAsync(abs, args, { cwd })
  if (r.exitCode === 0) return true
  const code = typeof r.exitCode === 'number' ? r.exitCode : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outSuffix = out ? `\n${out}` : ''
  fail(`lint-php: ${label} — помилка (код ${code}, php.mdc)${outSuffix}`, reason)
  return false
}

/**
 * Detector php/project (read-only). Async — `runTool` викликає `spawnAsync` (ADR 260716-1354).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd
  const manifestPath = join(root, 'composer.json')

  if (!existsSync(manifestPath)) return reporter.result()

  const composer = resolveCmd('composer')
  if (!composer) {
    fail('lint-php: `composer` не знайдено в PATH (потрібен при наявному composer.json, php.mdc)', 'composer-missing')
    return reporter.result()
  }

  if (
    !(await runTool('composer audit', composer, ['audit', '--no-interaction'], root, fail, 'composer-audit-violation'))
  ) {
    return reporter.result()
  }

  const magoBin = await ensureToolAsync('mago')
  const phpVersion = await readPhpVersionConstraint(manifestPath)
  const magoArgs = phpVersion ? ['--php-version', phpVersion, 'analyze'] : ['analyze']
  await runTool('mago analyze', magoBin, magoArgs, root, fail, 'mago-analyze')

  return reporter.result()
}
