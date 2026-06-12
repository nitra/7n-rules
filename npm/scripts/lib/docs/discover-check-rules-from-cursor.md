---
docgen:
  source: npm/scripts/lib/discover-check-rules-from-cursor.mjs
  crc: 9a6916e1
  score: 100
---

# discover-check-rules-from-cursor.mjs

## Огляд

Файл зчитує базові імена файлів `.mdc` у директорії `.cursor/rules/` та генерує список ідентифікаторів правил для `npx @nitra/cursor fix`, використовуючи перевірку через JS-концерн або policy з `target.json`.

## Поведінка

MANAGED_RULE_FILE_PREFIX Визначає префікс керованих правил пакета у файлах `.cursor/rules/`.

mdcBasenameToCheckId Перетворює базове ім'я `.mdc` у id правила для `check <id>`.

discoverCheckRulesFromCursorRules Будує впорядкований список id перевірок за файлами правил на диску, фільтруючи їх за наявністю у доступних перевірок.

## Публічний API

MANAGED_RULE_FILE_PREFIX — визначає префікс для керованих правил у директорії `.cursor/rules/`.
mdcBasenameToCheckId — трансформує базове ім'я файлу `.mdc` у ідентифікатор правила для функції `check`.
discoverCheckRulesFromCursorRules — створює відсортований список ідентифікаторів перевірок на основі файлів правил з курсору.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
