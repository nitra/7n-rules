---
type: JS Module
title: main.mjs
resource: npm/rules/bun/package_json/main.mjs
docgen:
  crc: e609683b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Перевіряє файл `package.json` відповідно до політик, визначених у конфігурації. Надає список виявлених порушень, спираючись на `package.json`.

## Поведінка

1. Перевіряє конфігурацію `package.json` на відповідність політичним вимогам, визначеним для цього правила.
2. Повертає результат перевірки, що містить список виявлених порушень.

## Публічний API

lint — Перевіряє, чи код відповідає політикам, визначеним у `package.json` та кодогенераційній обгортці.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
