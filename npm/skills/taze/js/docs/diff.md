---
type: JS Module
title: diff.mjs
resource: npm/skills/taze/js/diff.mjs
docgen:
  crc: fe4d76ce
  score: 100
---

parseVersion
Парсить версію з specifier.

isBreaking
Перевіряє перехід версій згідно з caret-семантикою.

diffPackageJson
Порівнює об'єкти package.json і повертає зміни залежностей.

collectTazeDiff
Збирає diff по всьому монорепо порівнюючи бекап та новий файл.

runTazeCli
Друкує результат diff у форматі JSON.

## Поведінка

parseVersion
Парсить версію з specifier

isBreaking
Перевіряє перехід версій згідно з caret-семантикою

diffPackageJson
Порівнює об'єкти package.json і повертає зміни залежностей

collectTazeDiff
Збирає diff по всьому монорепо порівнюючи бекап та новий файл

runTazeCli
Друкує результат diff у форматі JSON

## Публічний API

parseVersion — витягує версію з specifier-а, ігноруючи range-префікси.
isBreaking — визначає, чи є перехід між версіями breaking за caret-семантикою (зміна найлівішої ненульової частини).
diffPackageJson — порівнює два package.json-об'єкти та генерує список змін залежностей.
collectTazeDiff — збирає різницю між версіями всього монорепо, порівнюючи `package.json` з його резервною копією у кожному воркспейсі.
runTazeCli — виконує команду `n-cursor taze diff` для виведення компактного JSON зі списком major-оновлень та лічилки minor/patch.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Не звертається до мережі.
