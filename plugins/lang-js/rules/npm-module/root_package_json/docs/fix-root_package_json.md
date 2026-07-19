---
type: JS Module
title: fix-root_package_json.mjs
resource: plugins/lang-js/rules/npm-module/root_package_json/fix-root_package_json.mjs
docgen:
  crc: 7b0c2f93
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` перевіряє кореневий `package.json` на відповідність еталонному шаблону npm-module і використовується для контролю очікуваної структури цього конфіга. Публічна функція: `patterns`. Конфіг, на який спирається код: `package.json`.

## Поведінка

1. `patterns` визначає набір правил, які звіряють кореневий `package.json` з еталонним шаблоном для npm-module.
2. Кожне правило в цьому наборі націлене на `package.json` і використовується для вирівнювання кореневого конфіга з очікуваною структурою проєкту.
3. `patterns` потрібен, щоб централізовано підтримувати однаковий формат root `package.json` у межах цього типу пакета.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
