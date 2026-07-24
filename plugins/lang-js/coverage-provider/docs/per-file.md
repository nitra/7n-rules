---
type: JS Module
title: per-file.mjs
resource: plugins/lang-js/coverage-provider/per-file.mjs
docgen:
  crc: ce5f785d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує збір delta-виміру per-file line coverage для покриття рядків змінених файлів. Збір статистики здійснюється шляхом запуску `project-local vitest` (`bunx vitest`), представляючи легкий шлях без мутаційного тестування. Функціональність передбачає аналіз помилок за допомогою публічної функції `parseFailingTests` та збір агрегованих даних через `collectPerFile`. У рамках цього шляху покриття для `.vue` файлів, яке збирається через browser-mode Storybook-вимір, свідомо не застосовується.

## Поведінка

Коли необхідно оцінити покриття рядків змінених файлів, виконується повний запуск тестів у проєкті, але аналіз lcov обмежується лише тими файлами, що зазнали змін, з урахуванням залежності Vitest, визначеної в package.json. Функція collectPerFile ініціює цей процес, використовуючи інші функції для ідентифікації кандидатів для перевірки. Зібрані дані подаються до функції collectPerFile, яка агрегує результати. У разі необхідності парсингу помилок тестів, функція parseFailingTests аналізує JSON-звіт Vitest, виходячи з шляху до цього звіту.

## Публічний API

- parseFailingTests — Парсить JSON-звіт vitest у список падаючих тест-файлів з короткими помилками
(вхід fix-шляху `fix/fix-tests.mjs`; перенесено з coverage-per-file `@7n/test`).
- collectPerFile — Міряє per-file line coverage змінених файлів по всіх JS-roots проєкту.
Прогін suite повний (`--passWithNoTests`), але lcov обмежено зміненими
файлами через `--coverage.include` — файли без жодного тесту зʼявляються
в lcov з 0% (vitest 4: явний include замість прибраного `coverage.all`).

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
