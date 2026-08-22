---
type: Rust Module
title: adr_cmd.rs
resource: crates/rules-cli/src/adr_cmd.rs
docgen:
  crc: 82ce56cb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Native-команда `adr-normalize-local` — порт CLI-обгортки `npm/scripts/lib/adr/normalize-cli.mjs` поверх `rules-adr`.  Контракт незмінний: bash (`normalize-decisions.sh`) готує батч і clean-список файлами, викликає команду, парсить зі stdout `{"operations": [...]}` і застосовує сам; прогрес — у stderr (потрапляє в normalize-decisions.log).  Аргументи: `--batch <file>` (обов'язковий), `--clean <file>`, `--adr-dir <dir>` (дефолт `cwd/docs/adr`). ENV: `ADR_NORMALIZE_ALLOW_CLOUD=1`, `ADR_NORMALIZE_VOTES=N` (дефолт 2).

## Поведінка

`run` повертає `ExitCode::FAILURE`, якщо бракує обов’язкового batch-файла, не читається список чернеток чи clean-список, не відкривається окрема чернетка або не вдається створити async-рантайм. У цих випадках помилка додатково виводиться в stderr; успадковані помилки з підлеглого pipeline можуть пройти далі без локального перехоплення.

За нормального завершення результат для викликача — JSON з `operations` у stdout, а службова діагностика й статистика йдуть у stderr. Це дозволяє зовнішньому обгортанню окремо застосовувати операції та збирати журнал прогресу.

Поведінка залежить від середовища: cloud-режим вмикається лише явним `ADR_NORMALIZE_ALLOW_CLOUD=1`, а кількість голосів береться з `ADR_NORMALIZE_VOTES` лише як додатне значення; інакше використовується значення за замовчуванням.

## Публічний API

- run — Точка входу субкоманди — порт `runAdrNormalizeLocalCli`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
