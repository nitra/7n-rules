---
type: JS Module
title: lint.mjs
resource: npm/rules/php/js/lint.mjs
docgen:
  crc: 61ee5ead
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

## Огляд

Скрипт виконує серію перевірок якості та безпеки коду PHP, починаючи з запуску `composer audit` відповідно до правила php.mdc. Якщо у корені проєкту присутній `composer.json`, скрипт послідовно запускає PHPStan, Psalm, PHP-CS-Fixer (у режимі `dry-run`) та PHPCS зі стандартом Security. Якщо відповідний виконуваний файл інструменту відсутній у `vendor/bin/`, відповідний крок пропускається. Якщо `composer.json` відсутній у корені, скрипт завершує роботу з кодом 0.

## Поведінка

getPhpcsCodePaths визначає шляхи до каталогів коду для PHPCS, перевіряючи типові директорії (`app`, `src`, `lib`, `public`, `www`) та повертаючи `.`, якщо жодна з них не знайдена.
run виконує послідовність перевірок PHP: запускає `composer audit`, а потім, якщо інструменти встановлені, запускає PHP-CS-Fixer (у режимі `dry-run`), PHPCS (зі стандартом Security, ігноруючи `.git` та `node_modules`), PHPStan та Psalm.
lint оркеструє запуск `run` для виконання лінтування PHP у вказаному корені репозиторію.

## Публічний API

getPhpcsCodePaths — Визначає шляхи до каталогів коду для PHPCS.
run — Запускає інструмент `lint-php`.
lint — Виконує перевірки якості коду: аналіз залежностей (`composer audit`), форматування коду (`php-cs-fixer --dry-run`) та статичний аналіз (`phpstan`/`psalm`) через `runStandardLint`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
