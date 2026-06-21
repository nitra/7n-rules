---
type: JS Module
title: lint.mjs
resource: npm/rules/php/lint/lint.mjs
docgen:
  crc: 5788a4f9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Скрипт запускає перевірку залежностей за допомогою `composer audit` відповідно до правила php.mdc. Якщо в корені присутній `composer.json`, скрипт перевіряє доступність `composer` у PATH. Після цього, за наявності відповідних бінарних файлів у `vendor/bin/`, він запускає PHPStan, Psalm, PHP-CS-Fixer (у режимі dry-run) та PHPCS зі стандартом Security. Скрипт пропускає перевірку, якщо відповідний інструмент не встановлений. Якщо `composer.json` відсутній у корені, скрипт завершується успішно без запуску інструментів.

## Поведінка

getPhpcsCodePaths визначає шляхи до каталогів коду для PHPCS, перевіряючи типові директорії (`app`, `src`, `lib`, `public`, `www`) та повертаючи `.`, якщо жодна з них не знайдена.
run запускає повний процес лінтингу PHP: перевіряє залежності через `composer audit`, а потім, якщо інструменти встановлені, запускає PHP-CS-Fixer (dry-run), PHPCS (зі стандартом Security, ігноруючи `.git` та `node_modules`), PHPStan та Psalm.

## Публічний API

getPhpcsCodePaths — Визначає шляхи до каталогів коду для аналізу PHPCS.
run — Запускає інструмент `lint-php`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
