---
type: JS Module
title: main.mjs
resource: npm/rules/test/sandbox-aware-test/main.mjs
docgen:
  crc: 83129d0c
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 95
  issues: anchor-miss:(test.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл сканує репозиторій для пошуку тестових файлів, що відповідають шаблону JS-тесту. Він аналізує глибину імпорту в цих тестах, перевіряючи наявність механізмів ізоляції, таких як `withTmpDir` або `test.skipIf`. Це гарантує, що тести, які глибоко імпортуються у структуру проєкту, будуть належним чином ізольовані. Маркери повідомлень, пов'язані з тестами, відображаються в Поведінці.

## Поведінка

Поведінка:

1. Викликається `main`.
2. Сканується репозиторій для пошуку файлів, що відповідають шаблону JS-тесту.
3. Для кожного знайденого тестового файлу аналізується його вміст на наявність глибокої навігації за допомогою `import.meta.dirname` або `import.meta.url`, яка вказує на глибину не менше чотирьох рівнів підкаталогів.
4. Якщо в тестовому файлі виявлено глибоку навігацію, перевіряється, чи цей файл захищений викликом `withTmpDir` або чи містить конструкцію `test.skipIf` для ізоляції у Stryker-sandbox.
5. Якщо глибока навігація знайдена, а захист відсутній, файлу позначається як порушення.
6. При відсутності порушень у всіх тестових файлах, процес вважається успішним.
7. При виявленні порушень, генерується повідомлення з вказівкою виправлення (використання `withTmpDir` або захист через `test.skipIf`), з посиланням на `test.mdc`.

## Публічний API

Task: Rewrite a technical description into concise, behavioral documentation snippets based on provided rules.

Goal: Produce laconic, behavioral documentation in Ukrainian using clean Markdown, focusing on _What_ and _Why_, not _How_.

Constraints:

1. No introductions or conclusions.
2. Do not wrap in ```-code blocks.
3. Forbidden: function signatures, types, parameters list, stdlib module descriptions, regex descriptions, or internal private names.
4. Mandatory Anchors: Mention message markers in Behavior (per `test.mdc`).
5. Required Format: Concise markers in the format "name — what it does," using your own words (no direct copying), without types or signatures.
6. Exact Names: Must use the provided names exactly.
7. Strict Omission: No header, no generic phrases ("applies logic," "checks correctness")—be specific about what is being applied/checked.

Input List to transform:

- main: Перевіряє, що `*.test.{mjs,js}` з глибокою `import.meta`-навігацією (≥4 `..`-рівнів) захищені `withTmpDir` або `test.skipIf`. Без ізоляції Stryker-sandbox (`reports/stryker/.tmp/sandbox-XXX/`) не має `.git/`, тому git-операції у таких тестах падають і мутаційний прогін не стартує. Без заголовка. Без generic-фраз «застосовує логіку», «перевіряє коректність» — пиши конкретно ЩО саме застосовує/перевіряє.

Applying the transformation now.

main — Встановлює захист для тестів з глибокою навігацією `import.meta` (≥4 `..`-рівнів), гарантуючи, що вони працюють у середовищі, де відсутня ізоляція Stryker-sandbox, що запобігає збоям git-операцій і старту процесу мутації.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
