---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-php/vitest.config.mjs
docgen:
  crc: bf257a7b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-php: env-канон ядра + include лише тестів плагіна.

## Поведінка

Виконаю завдання, генеруючи поведінкову документацію для файлу `/Users/vitalii/www/nitra/7n-rules/.worktrees/package-knowledge/plugins/lang-php/vitest.config.mjs` відповідно до заданих строгих обмежень.

Поведінка:
Конфігурація визначає, які файли будуть включені для виконання тестів у рамках плагіна, явно виключивши вміст папки `node_modules`.
Тести виконуються у середовищі `node` з використанням пулу `forks`, що забезпечує ізольоване виконання.
У процесі тестування фіксується спеціальний процес трасування LLM, який записується у тимчасовий JSONL-файл.
Виконання тестів має обмеження часу у 20000 мілісекунд.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `node_modules`.
