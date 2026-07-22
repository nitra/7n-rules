---
type: JS Module
title: aggregate.mjs
resource: plugins/lang-js/coverage-provider/aggregate.mjs
docgen:
  crc: 7e368294
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль об’єднує часткові coverage та mutation підсумки в накопичувані totals для звітності. `addCoverage` і `addMutation` дають collector-ам та оркестратору спільні правила сумування без прямої залежності один від одного, щоб уникнути циклічного імпорту між collector і orchestrator.

## Поведінка

addCoverage і addMutation приймають уже зібрані часткові підсумки від collector-ів або оркестратора та повертають новий об’єднаний підсумок для подальшого накопичення чи фінального звіту.

Обидві функції працюють як чистий шар агрегації: не читають вихідні coverage/mutation-файли, не змінюють спільний стан і не координують запуск перевірок. Це дозволяє collector-ам і оркестратору використовувати однакові правила сумування без прямої залежності один від одного.

addCoverage агрегує покриття за спільними категоріями рядків і функцій, зберігаючи окремо кількість покритих і загальних елементів. addMutation агрегує mutation-результати за кількістю спійманих і загальних мутантів.

## Публічний API

- addCoverage — Сума двох coverage-totals.
- addMutation — Сума двох mutation-counts.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
