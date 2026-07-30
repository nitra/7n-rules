/**
 * lint-поверхня php/mago_lint: read-only detector (`mago lint`, detect-only — БЕЗ `--fix`,
 * інваріант «lint без мутацій джерел»). Замінює колишній `php/phpcs` (`phpcs --standard=Security`
 * з `vendor/bin`) — mago резолвиться через `ensureToolAsync` (standalone Rust-бінарник, без
 * PHP-рантайму й без vendor/), spec `docs/specs/2026-07-30-mago-php-toolchain.md`. Per-file:
 * приймає `ctx.files`, інакше `.` (весь проєкт).
 *
 * Спеціалізований security-стандарт phpcs (`--standard=Security`,
 * `squizlabs/php_codesniffer` + `php-security-audit`) замінено на curated
 * lint-правила mago — parity з phpcs Security НЕ підтверджена формально; фактична
 * поведінка закріпленого піна mago зафіксована security-фікстурами
 * (`tests/fixtures/security/`, `tests/main.test.mjs`) як документація покриття —
 * апгрейд піна показуватиме зміни покриття, а не мовчазний регрес.
 *
 * На відміну від phpcs (vendor-optional тул, тихий skip при відсутності) mago —
 * ensure-tool-керований: відсутність бінарника й вимкнений авто-install → hard-fail
 * (`ensureToolAsync` кидає), той самий патерн, що й `conftest`/`opa` в `run-conftest-batch.mjs`.
 *
 * Спільна per-file mago-логіка (composer.json gate, targets, ensureToolAsync, spawnAsync,
 * fail-повідомлення) винесена у `../lib/mago-per-file-detector.mjs` — той самий каркас,
 * що й `php/mago_fmt` (jscpd: дублікат структури без цього рефакторингу).
 * @see ./docs/main.md
 */
import { createMagoPerFileDetector } from '../lib/mago-per-file-detector.mjs'

/**
 * Detector php/mago_lint (read-only, БЕЗ автофіксу). Async (не блокує event loop) —
 * детектор може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export const lint = createMagoPerFileDetector({
  // Без --fix/--unsafe/--potentially-unsafe — detect-only, дефолтний --minimum-fail-level
  // error визначає ненульовий вихідний код (mago's default: warning/note/help не валять exit).
  magoArgs: ['lint'],
  reason: 'mago-lint',
  label: 'mago lint — знайдено порушення',
  mdcName: 'mago_lint.mdc'
})
