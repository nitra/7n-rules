---
type: JS Module
title: formatting.mjs
resource: npm/rules/text/js/formatting.mjs
docgen:
  crc: 34048813
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Модуль перевіряє відповідність конфігураційних файлів та скриптів встановленим вимогам. Він перевіряє наявність конфігураційних файлів, на які спираються `package.json`, `extensions.json`, `target.json`, `.oxfmtrc.json` та `.cspell.json`. Модуль використовує функцію `check` для валідації налаштувань.

## Поведінка

1. Викликається функція check.
2. Ініціалізується механізм збору результатів перевірки.
3. Виконується перевірка файлу .v8rignore на відповідність вимогам.
4. Виконується перевірка наявності текстових конфігураційних файлів: .oxfmtrc.json, .cspell.json, .markdownlint-cli2.jsonc, .vscode/extensions.json, .vscode/settings.json.
5. Перевіряється абзац про український апостроф у файлах n-text.mdc або npm/mdc/text.mdc, якщо вони існують.
6. Виконується перевірка CI-workflow у файлі .github/workflows/lint-text.yml на наявність кроку `n-cursor lint text --read-only`.
7. Повертається код виходу, що відображає загальний статус перевірки.

## Публічний API

check — порівнює структуру проєкту з вимогами text.mdc.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
