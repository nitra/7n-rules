---
type: JS Module
title: fix-package_json.mjs
resource: npm/rules/js/package_json/fix-package_json.mjs
docgen:
  crc: 048fe1b5
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` забезпечує перевірку й звірку `package.json` з очікуваним шаблоном цього проєкту. Модуль читає `package.json` як основний конфіг, на який спирається код, і використовується для оцінки відповідності структури та вмісту файла вимогам проєкту. Робота read-only: змін у файловій системі чи базі даних не вносить.

## Поведінка

1. `patterns` надає набір правил, які приводять `package.json` до очікуваного шаблону для цього проєкту.
2. Кожне правило орієнтується на конфігурацію `package.json` і застосовується до нього як до цільового файлу.
3. `patterns` використовується як публічна точка входу для перевірки й вирівнювання структури `package.json` без змін у файловій системі чи базі даних.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
