---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/mago_lint/main.mjs
docgen:
  crc: 5db31765
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

lint-поверхня php/mago_lint: read-only detector (`mago lint`, detect-only — БЕЗ `--fix`,
інваріант «lint без мутацій джерел»). Замінює колишній `php/phpcs` (`phpcs --standard=Security`
з `vendor/bin`) — mago резолвиться через `ensureToolAsync` (standalone Rust-бінарник, без
PHP-рантайму й без vendor/), spec `docs/specs/2026-07-30-mago-php-toolchain.md`. Per-file:
приймає `ctx.files`, інакше `.` (весь проєкт).

Спеціалізований security-стандарт phpcs (`--standard=Security`,
`squizlabs/php_codesniffer` + `php-security-audit`) замінено на curated
lint-правила mago — parity з phpcs Security НЕ підтверджена формально; фактична
поведінка закріпленого піна mago зафіксована security-фікстурами
(`tests/fixtures/security/`, `tests/main.test.mjs`) як документація покриття —
апгрейд піна показуватиме зміни покриття, а не мовчазний регрес.

На відміну від phpcs (vendor-optional тул, тихий skip при відсутності) mago —
ensure-tool-керований: відсутність бінарника й вимкнений авто-install → hard-fail
(`ensureToolAsync` кидає), той самий патерн, що й `conftest`/`opa` в `run-conftest-batch.mjs`.

Спільна per-file mago-логіка (composer.json gate, targets, ensureToolAsync, spawnAsync,
fail-повідомлення) винесена у `../lib/mago-per-file-detector.mjs` — той самий каркас,
що й `php/mago_fmt` (jscpd: дублікат структури без цього рефакторингу).

## Публічний API

- lint — Detector php/mago_lint (read-only, БЕЗ автофіксу). Async (не блокує event loop) —
детектор може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).

## Сценарії використання

- `plugins/lang-php/rules/php/mago_lint/tests/main-hard-fail.test.mjs` (php/mago_lint detector — hard-fail без mago в PATH) — mago відсутній + N_CURSOR_NO_AUTO_INSTALL=1 → lint() кидає (не тихий skip)
- `plugins/lang-php/rules/php/mago_lint/tests/main-integration.test.mjs` — чистий файл → без порушень (рівня error); синтаксична помилка → mago-lint (parse error, рівень error)
- `plugins/lang-php/rules/php/mago_lint/tests/main.test.mjs` (php/mago_lint detector) — немає composer.json → без порушень, mago не резолвиться/не спавниться; composer.json є, ctx.files без .php → без порушень, mago не спавниться; happy-path: mago lint exit 0, без порушень у виводі → без порушень; лише warning (strict-types), exit 0 (дефолт fail-level=error) → без порушень; ctx.files === undefined (full-scope) → targets = [; ще 1
- `plugins/lang-php/rules/php/mago_lint/tests/security-fixtures.test.mjs` — eval_user_input.php → ловить (mago-lint / no-eval, error-рівень); sql_injection.php → НЕ ловить SQL injection (лише стиль, exit 0); xss_echo.php → НЕ ловить XSS (лише стиль, exit 0); command_injection.php → НЕ ловить command injection (лише стиль, exit 0)

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
