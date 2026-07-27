---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/cs_fixer/main.mjs
docgen:
  crc: 224d2f1a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

lint-поверхня php/cs_fixer: read-only detector (`php-cs-fixer fix --dry-run --diff`, з
`vendor/bin`). Per-file: приймає `ctx.files`, інакше `.` (весь проєкт). Виділено з колишнього
bundled `php/check` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення
python/php/rego") — php-cs-fixer приймає список конкретних файлів аргументом.

## Поведінка

lint працює лише для проєкту, де є `composer.json`; без нього поверхня мовчки нічого не повідомляє. Для вибіркового запуску вона враховує лише PHP-файли з переданого списку, а без списку перевіряє весь проєкт через корінь.

Якщо `vendor/bin/php-cs-fixer` відсутній, перевірка не падає і просто не дає порушень. Саме `lint` є єдиним публічним контрактом цієї поверхні.

За помилки від зовнішньої перевірки `lint` повертає одне порушення з кодом помилки та коротким фрагментом виводу; обсяг тексту обмежений, щоб не роздувати звіт. Одночасне виконання безпечне: поверхня не зберігає стан між запусками.

## Публічний API

- lint — Detector php/cs_fixer (read-only). Async (не блокує event loop) — детектор може виконуватись
у parallel lane `detectAll()` (ADR 260716-1354).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
