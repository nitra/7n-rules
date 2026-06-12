---
docgen:
  source: npm/rules/js-mssql/js/deps.mjs
  crc: d5bc32ba
  score: 100
---

# deps.mjs

## Огляд

request
Витягує рядок версії `dependencies.mssql` з `package.json` (js-mssql.mdc)

check
Перевіряє використання `mssql` у джерелах коду та порівнює його версію з версією у `package.json` (package.json)

## Поведінка

request
Витягує рядок версії `dependencies.mssql` з package.json

request
Витягує рядок версії `dependencies.mssql` з package.json

check
Аудитує використання mssql у джерелах коду та перевіряє відповідність версії mssql у package.json

## Публічний API

request: Створює запит для бази даних
request: Формує запит для бази даних
check: Перевіряє відповідність проєкту правилу js-mssql.mdc

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Не звертається до мережі.
