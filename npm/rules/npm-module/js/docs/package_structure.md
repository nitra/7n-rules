---
docgen:
  source: npm/rules/npm-module/js/package_structure.mjs
  crc: 943e3b76
  score: 85
---

# package_structure.mjs

## Огляд

globToRegex
Перетворює glob-патерн у RegExp з якорями `^` та `$`.

findTestFrameworkImport
Знаходить імпорт модуля тест-фреймворку з контенту файлу.

classifyPublishedFileAsTest
Класифікує опублікований файл як test/fixture за ознаками.

check
Перевіряє відповідність проєкту правилам (npm-module.mdc).

## Поведінка

globToRegex
Перетворює glob-патерн у RegExp з якорями `^` / `$`.

findTestFrameworkImport
Знаходить імпорт модуля тест-фреймворку з контенту файлу.

classifyPublishedFileAsTest
Класифікує опублікований файл як test/fixture за ознаками.

check
Перевіряє відповідність проєкту правилам npm-module.mdc.

## Публічний API

GlobToRegex — перетворює glob-патерн у RegExp з використанням `^` та `$`. Підтримує globstar, `*`, `?` та brace-альтернативи.
FindTestFrameworkImport — визначає наявність імпорту/require/dynamic-import модуля тест-фреймворку. Парсинг через oxc-parser повертає `null` у разі помилки.
ClassifyPublishedFileAsTest — відносить опублікований файл до test/fixture, якщо присутні ознаки: каталог з `TEST_DIR_NAMES`, збіг імені файлу з `TEST_FILE_PATTERNS`, або імпорт тест-фреймворку для JS/TS розширень.
Carve-out — витягує ім'я правила з шляху `rules/<rule-name>/...` (індекс 1), що позначає ім'я правила. Правило з id `test` або `tests` описує конвенцію розміщення тестів, але не є test-fixture. Подальші сегменти продовжують перевірку.
Check — перевіряє відповідність проєкту правилам npm-module.mdc.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Свідомо пропускає шляхи: `.github`, `.git`.
- Не звертається до мережі.
