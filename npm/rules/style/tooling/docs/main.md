---
type: JS Module
title: main.mjs
resource: npm/rules/style/tooling/main.mjs
docgen:
  crc: 4333b971
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
  issues: anchor-miss:extensions.json,anchor-miss:settings.json,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Please provide the code file you want me to document. I will then generate the "Огляд" section based on the provided "Поведінка" and the file's content, adhering to all specified rules.

## Поведінка

Поведінка:

1. main: Перевіряє наявність конфігурації stylelint. Конфігурація може бути визначена у пакеті `package.json` або у зовнішніх файлах конфігурації, зокрема `.stylelintrc.json`, `.stylelintrc.js`, `.stylelintrc.cjs`, `.stylelintrc.mjs`, `stylelint.config.js`, `stylelint.config.cjs`, `stylelint.config.mjs`. Якщо жоден із цих варіантів відсутній, видається помилка, і пропонується додати конфігурацію до `package.json` з посиланням на `@nitra/stylelint-config` (згадка (js.mdc)).
2. main: Перевіряє існування файлу `.stylelintignore`. Якщо він не існує, видається помилка, і пропонується створити його з вмістом `dist/`.
3. main: Якщо `.stylelintignore` існує, він перевіряє, чи містить він рядок `dist/`. Якщо цього рядка немає, видається помилка з проханням додати його (згадка (style.mdc)).
4. main: Перевіряє існування файлу `.github/workflows/lint-style.yml`. Якщо він відсутній, видається помилка з проханням його створити.
5. Робота ігнорує шляхи в каталозі `.github` та `.git` під час перевірки.

## Публічний API

main — забезпечує дотримання стандартів стилізації проєкту відповідно до правил style.mdc

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
