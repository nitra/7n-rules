---
type: JS Module
title: fix-oxfmtrc.mjs
resource: npm/rules/text/oxfmtrc/fix-oxfmtrc.mjs
docgen:
  crc: d2983472
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 100
---

## Огляд

Issue: Не надано текст чорнетки для аналізу.

## Поведінка

1. Застосування шаблону deep-merge до файлу Конфіги .oxfmtrc.json
2. Збереження локальних ключів конфігу під час застосування deep-merge

## Публічний API

- patterns — Fix-патерни концерну: один шаблонний deep-merge у `.oxfmtrc.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
