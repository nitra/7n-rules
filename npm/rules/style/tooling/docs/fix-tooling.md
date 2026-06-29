---
type: JS Module
title: fix-tooling.mjs
resource: npm/rules/style/tooling/fix-tooling.mjs
docgen:
  crc: d9c7a757
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Виконую завдання як технічний письменник.

Файл забезпечує детерміновані виправлення файлової системи для автоматичного налаштування інструменту Stylelint. Публічна функція `patterns` виконує перехоплення помилок (fail-safe), не генеруючи винятків. Код спирається на конфігурацію `package.json` і гарантує, що директорія `dist/` виключена з перевірки Stylelint через створення або доповнення `.stylelintignore`, а також додає необхідну конфігурацію Stylelint до `package.json`.

## Поведінка

Поведінка:

1. Перевіряється наявність файлу `.stylelintignore`. Якщо він відсутній, створюється з вмістом `dist/`.
2. Якщо файл `.stylelintignore` існує, перевіряється, чи містить він рядок `dist/`. Якщо ні, до файлу додається рядок `dist/`.
3. Перевіряється, чи міститься конфігурація `stylelint` у файлі `package.json`. Якщо конфігурація відсутня, вона додається до `package.json` з посиланням на `@nitra/stylelint-config`.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
