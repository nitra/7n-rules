---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/mago_fmt/main.mjs
docgen:
  crc: c2c6c220
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

lint-поверхня php/mago_fmt: read-only detector форматування (`mago format --dry-run`).
Замінює колишній `php/cs_fixer` (php-cs-fixer з `vendor/bin`) — mago резолвиться через
`ensureToolAsync` (standalone Rust-бінарник, без PHP-рантайму й без vendor/), spec
`docs/specs/2026-07-30-mago-php-toolchain.md`. Per-file: приймає `ctx.files`, інакше `.`
(весь проєкт) — узгоджено з попереднім cs_fixer.

На відміну від cs_fixer (vendor-optional тул, тихий skip при відсутності) mago —
ensure-tool-керований: відсутність бінарника й вимкнений авто-install → hard-fail
(`ensureToolAsync` кидає), той самий патерн, що й `conftest`/`opa` в `run-conftest-batch.mjs`.

Спільна per-file mago-логіка (composer.json gate, targets, ensureToolAsync, spawnAsync,
fail-повідомлення) винесена у `../lib/mago-per-file-detector.mjs` — той самий каркас,
що й `php/mago_lint` (jscpd: дублікат структури без цього рефакторингу).

## Публічний API

- lint — Detector php/mago_fmt (read-only). Async (не блокує event loop) — детектор може виконуватись
у parallel lane `detectAll()` (ADR 260716-1354).

## Сценарії використання

- `plugins/lang-php/rules/php/mago_fmt/tests/main-hard-fail.test.mjs` (php/mago_fmt detector — hard-fail без mago в PATH) — mago відсутній + N_CURSOR_NO_AUTO_INSTALL=1 → lint() кидає (не тихий skip)
- `plugins/lang-php/rules/php/mago_fmt/tests/main-integration.test.mjs` — відформатований файл → без порушень; неформатований файл → mago-fmt-unformatted
- `plugins/lang-php/rules/php/mago_fmt/tests/main.test.mjs` (php/mago_fmt detector) — немає composer.json → без порушень, mago не резолвиться/не спавниться; composer.json є, ctx.files без .php → без порушень, mago не спавниться; happy-path: mago format --dry-run exit 0 → без порушень; ctx.files === undefined (full-scope) → targets = [; неформатований файл (exit 1) → mago-fmt-unformatted з реальним diff-виводом у message; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
