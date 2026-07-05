---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/check/main.mjs
docgen:
  crc: 715702d3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Lint-детектор concern-а `doc-files/check`: виявляє застарілі файлові доки (CRC-mismatch, відсутність, деградація) та «сирітські» доки, чиє джерело видалено. Виключно read-only детект — генерація й очистка живуть у `fix-worker.mjs` (docgen), не тут.

## Поведінка

1. `lint(ctx)`: у delta-режимі (`ctx.files` задано) змінені шляхи зводяться до множини вихідних кодових файлів — для зміненої `docs/*.md`-доки reverse-map-ом знаходиться її джерело у батьківській теці; без `ctx.files` — повний скан репо.
2. Для кожного джерела перевіряється актуальність його доки (`describeFile`/`scanForDocFiles`); застаріла/відсутня дока → порушення з причиною (`reason`) і шляхом джерела.
3. Окремо скануються «сирітські» доки (`scanOrphanedDocs`) — `docs/*.md`, чиє джерело видалено; кожна — порушення `orphaned-doc`.
4. Повертається `LintResult` зі списком порушень — без жодних мутацій.

## Публічний API

collectStale — перелік застарілих доків: для `files` (delta) або всього репо (undefined);
lint — детектор застарілих і сирітських файлових доків, повертає `{ violations }`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Fail-safe: помилка читання теки джерела дає `null`-reverse-map (джерело пропускається), не виняток.
