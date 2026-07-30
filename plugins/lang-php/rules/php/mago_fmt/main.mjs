/**
 * lint-поверхня php/mago_fmt: read-only detector форматування (`mago format --dry-run`).
 * Замінює колишній `php/cs_fixer` (php-cs-fixer з `vendor/bin`) — mago резолвиться через
 * `ensureToolAsync` (standalone Rust-бінарник, без PHP-рантайму й без vendor/), spec
 * `docs/specs/2026-07-30-mago-php-toolchain.md`. Per-file: приймає `ctx.files`, інакше `.`
 * (весь проєкт) — узгоджено з попереднім cs_fixer.
 *
 * На відміну від cs_fixer (vendor-optional тул, тихий skip при відсутності) mago —
 * ensure-tool-керований: відсутність бінарника й вимкнений авто-install → hard-fail
 * (`ensureToolAsync` кидає), той самий патерн, що й `conftest`/`opa` в `run-conftest-batch.mjs`.
 *
 * Спільна per-file mago-логіка (composer.json gate, targets, ensureToolAsync, spawnAsync,
 * fail-повідомлення) винесена у `../lib/mago-per-file-detector.mjs` — той самий каркас,
 * що й `php/mago_lint` (jscpd: дублікат структури без цього рефакторингу).
 * @see ./docs/main.md
 */
import { createMagoPerFileDetector } from '../lib/mago-per-file-detector.mjs'

/**
 * Detector php/mago_fmt (read-only). Async (не блокує event loop) — детектор може виконуватись
 * у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export const lint = createMagoPerFileDetector({
  magoArgs: ['format', '--dry-run'],
  reason: 'mago-fmt-unformatted',
  label: 'mago format (dry-run) — потрібне форматування',
  mdcName: 'mago_fmt.mdc'
})
