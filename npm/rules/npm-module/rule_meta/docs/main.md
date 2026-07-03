---
type: JS Module
title: main.mjs
resource: npm/rules/npm-module/rule_meta/main.mjs
docgen:
  crc: 4037509e
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 95
  issues: anchor-miss:(scripts.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Please provide the code file you would like me to document. I need the code to write the "Огляд" section based on the provided "Поведінка".

## Поведінка

Поведінка:

1. Ініціює процес валідації, перевіряючи директорію `npm/rules/`.
2. Для кожної піддиректорії правил:
   a. Перевіряє відсутність файлу `auto.md`, видаючи попередження, якщо знайдений.
   b. Перевіряє наявність обов'язкового файлу `main.mdc` згідно з конвенцією `scripts.mdc`.
   c. Зчитує метадані за допомогою `main.json`.
   d. Валідує налаштування автоматичного режиму правила, використовуючи `meta.json`.
   e. Валідує налаштування лінтування правила, перевіряючи `meta.json` та вміст `main.mjs` на відповідність експорту `lint`.
3. Повертає код завершення, який відображає результат валідації.

## Публічний API

main — перевіряє, чи всі метадані у файлах `npm/rules/<id>/meta.json` коректні.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
