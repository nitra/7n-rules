---
type: JS Module
title: fix-package_json.mjs
resource: npm/rules/style/package_json/fix-package_json.mjs
docgen:
  crc: deb26703
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає `patterns` для визначення очікуваних перевірок, що спираються на `package.json`. Використовується як read-only опис вимог до конфігурації пакета, без самостійних змін файлової системи.

## Поведінка

1. `patterns` визначає правило виправлення для `package.json`.

2. `patterns` забезпечує приведення `package.json` до проєктного шаблону стилю.

3. `patterns` не змінює файлову систему самостійно, а лише описує доступний сценарій автоматичного виправлення для зовнішнього механізму перевірок.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
