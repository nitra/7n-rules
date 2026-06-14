---
docgen:
  source: npm/rules/doc-files/js/docgen-ignore.mjs
  crc: c17cd785
  score: 100
---

# docgen-ignore.mjs

## Огляд

DOCGEN_IGNORE_GLOBS
Список шляхів, які docgen повинен ігнорувати.

isDocgenIgnored
Перевіряє, чи шлях знаходиться у списку ігнорованих шляхів.

## Поведінка

DOCGEN_IGNORE_GLOBS
Базовий список glob-ів для docgen ignore

isDocgenIgnored
Перевіряє, чи шлях має бути пропущений docgen

## Публічний API

DOCGEN_IGNORE_GLOBS — Список glob-ів для ігнорування у `docgen`.
isDocgenIgnored — Визначає, чи шлях повинен бути пропущений `docgen`. Для `kind = 'dir'` працює і на підкаталоги, наприклад, `**\\/demo/**` спрацьовує на `demo/x` під час рекурсивного обходу.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
- Не звертається до мережі.
