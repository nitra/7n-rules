---
type: JS Module
title: main.mjs
resource: npm/rules/ci4/marksman_config/main.mjs
docgen:
  crc: 259b7df5
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min-retry
  score: 95
---

## Огляд

Overview
Перевіряє наявність файлу `.marksman.toml` у корені репозиторію. Порушення тригер ставить на копіювання канонічного baseline з `MARKSMAN_BASELINE_PATH`.

## Поведінка

Поведінка функції lint перевіряє наявність файлу `.marksman.toml` у корені репозиторію. Порушення тригер ставить на копіювання канонічного baseline з `MARKSMAN_BASELINE_PATH`.

## Публічний API

- MARKSMAN_BASELINE_PATH — Абсолютний шлях до канонічного baseline-конфігу marksman, що постачається разом із пакетом правил.
- MARKSMAN_TARGET_FILENAME — Імʼя конфіг-файлу marksman, який має лежати в корені репозиторію.
- lint — Перевіряє наявність `.marksman.toml` у корені; сигналить копіювання canonical baseline.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
