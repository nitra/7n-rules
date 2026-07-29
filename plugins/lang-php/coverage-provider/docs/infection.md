---
type: JS Module
title: infection.mjs
resource: plugins/lang-php/coverage-provider/infection.mjs
docgen:
  crc: 7df10d57
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

Парсинг JSON-звіту `infection/infection` (`--logger-json`) у контракт
CoverageRow: caught/total і survived-групи по файлах. Форма звірена за
офіційною JSON-схемою логера (infection/infection, `resources/schema.json`
— секції `stats`/`escaped`/`killed`/`timeouted`/`errored`/`notCovered`),
без live-прогону (test-only середовище без php-тулчейну).

Семантика caught/total дзеркалить rust-парсер (`mutants.mjs`): timeout
рахується як caught (мутант зупинив suite). `errored`/`ignored` виключені
зі знаменника — аналог `Unviable` у cargo-mutants (не валідний вимір, а не
пережитий мутант). `notCovered` (мутація на рядку без жодного тесту) —
валідний, але не спійманий мутант, тож іде у survived поруч з `escaped`.

## Публічний API

- parseInfectionReport — Рахує caught/total і збирає survived-мутанти зі звіту infection.

## Сценарії використання

- `plugins/lang-php/coverage-provider/tests/infection.test.mjs` (parseInfectionReport) — caught = killed + timedOut, total включає escaped/notCovered, виключає errored/ignored; survived групує escaped + notCovered по файлах; порожній звіт → нулі й порожній survived; декілька escaped-мутантів в одному файлі групуються в один запис

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
