---
type: JS Module
title: main.mjs
resource: npm/rules/text/formatting/main.mjs
docgen:
  crc: 14aa1bb9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: best-of-2:retry-won,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

**Огляд**
Цей код забезпечує консистентність конфігурації проєкту, перевіряючи наявність ключових конфігураційних файлів. Він також підтверджує відповідність налаштувань тексту та вимогам CI-процесів, спираючись на конфіги: extensions.json, settings.json, target.json, .oxfmtrc.json, .cspell.json, package.json.

**Поведінка**
При виклику функції main, код перевіряє наявність конфігураційних файлів для текстового стеку: .oxfmtrc.json, .cspell.json, extensions.json, settings.json, target.json, package.json. Якщо знаходяться правила text.mdc, відбувається перевірка щодо українського апострофа у цих правилах. Також перевіряється файл .github/workflows/lint-text.yml на відповідність вимогам до CI-workflow. Функція main повертає код завершення, відображаючи результат усіх перевірок. Код не взаємодіє з файловою системою чи базами даних.

## Поведінка

Поведінка:

1. Викликається функція main.
2. Проводиться перевірка файлу .v8rignore на наявність посилань на .vscode/extensions.json та .vscode/settings.json.
3. Проводиться перевірка наявності конфігураційних файлів для текстового стеку: .oxfmtrc.json, .cspell.json, .markdownlint-cli2.jsonc, .vscode/extensions.json, .vscode/settings.json.
4. Якщо знайдено правила text.mdc, виконується перевірка абзацу про український апостроф у цих правилах.
5. Проводиться перевірка файлу .github/workflows/lint-text.yml на відповідність вимогам до CI-workflow.
6. Функція main повертає код завершення, що відображає результат усіх перевірок. Не перевіряються шляхи .github та .git.

## Публічний API

main — перевіряє дотримання проєкту правил text.mdc.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
