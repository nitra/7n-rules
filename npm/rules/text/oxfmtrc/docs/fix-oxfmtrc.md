---
type: JS Module
title: fix-oxfmtrc.mjs
resource: npm/rules/text/oxfmtrc/fix-oxfmtrc.mjs
docgen:
  crc: 2902bd52
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічна точка входу `patterns` повертає набір правил вирівнювання для `.oxfmtrc.json` і слугує read-only джерелом очікуваного стану цього конфіга. Код спирається на конфіг `.oxfmtrc.json` як на залежність контексту, щоб узгоджувати його формат із прийнятими правилами.

## Поведінка

1. `patterns` формує набір виправлень для узгодження шаблонного конфіга з цільовим файлом `.oxfmtrc.json`.
2. Кожен елемент у `patterns` описує окреме правило вирівнювання цього конфіга, щоб тримати його в очікуваному стані.
3. `patterns` не виконує записів у файлову систему чи базу даних і не змінює інші файли поза `.oxfmtrc.json`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
