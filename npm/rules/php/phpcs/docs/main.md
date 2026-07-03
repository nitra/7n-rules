---
type: JS Module
title: main.mjs
resource: npm/rules/php/phpcs/main.mjs
docgen:
  crc: 3da9ada2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Please provide the file you would like me to document.

## Поведінка

getPhpcsCodePaths визначає список каталогів коду для аналізу за допомогою PHPCS, перевіряючи лише ті, що містять файли `.php` і ігноруючи папки `vendor`, `node_modules` та `.git`.
lint запускає зовнішній інструмент PHPCS зі стандартом `Security` для перевірки якості коду. Якщо вхідні файли не вказані, він сканує типові каталоги коду. Якщо `composer.json` відсутній або `phpcs` не знайдено, перевірка пропускається.

## Публічний API

getPhpcsCodePaths — визначає шляхи до файлів, які потрібно аналізувати за допомогою PHPCS.
lint — перевіряє код на відповідність стилістичним та якісним нормам, використовуючи PHPCS.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.git`, `node_modules`.
