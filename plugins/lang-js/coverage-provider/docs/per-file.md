---
type: JS Module
title: per-file.mjs
resource: plugins/lang-js/coverage-provider/per-file.mjs
docgen:
  crc: 01ba2bc2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 60
  issues: internal-name:hasVitestDep,internal-name:scopeGateFiles,internal-name:toGateRows,internal-name:collectRootRows,best-of-2:retry-error
---

## Огляд

Визначає метрику покриття рядків для змінених JavaScript/TypeScript-файлів у рамках правила `coverage` для концерну `coverage`. Ця метрика розраховується шляхом запуску локального `vitest` для кожного робочого простору проєкту, фокусуючись лише на рядках, що були змінені порівняно з базовою версією. Покриття `.vue` файлів не включається до цієї дельти.

## Поведінка

Для визначення покриття рядків змінених файлів відбувається послідовний виклик, який починається з `collectPerFile`, що аналізує змінені файли відносно кореня проєкту. Цей процес значно ускладнюється визначенням відповідних робочих просторів (`jsRoot`) і подальшим викликом `collectRootRows` для кожного з них. Функція `collectRootRows` ініціює повний прогін тестового набору для кожного `jsRoot`, збираючи дані про покриття рядків, і передає їх далі до `toGateRows` для відповідності з запитами про змінені файли. Перед початком вимірювання покриття, `collectPerFile` використовує `scopeGateFiles` для фільтрації кандидатів, які належать до відповідного `jsRoot`, і `hasVitestDep`, щоб перевірити, чи має цільовий проект залежність `vitest` у своєму `package.json`. У разі, коли виявлено падіння тестів, функція `parseFailingTests` може бути використана для аналізу JSON-звіту `vitest` та отримання списку тест-файлів із зазначенням помилок. Результати, зібрані з різних рівнів — від кожного файлу до кожного кореня — агрегуються для фінального звіту про покриття.

## Публічний API

- parseFailingTests — Парсить JSON-звіт vitest у список падаючих тест-файлів з короткими помилками
(вхід fix-шляху `fix/fix-tests.mjs`; перенесено з coverage-per-file `@7n/test`).
- collectPerFile — Міряє per-file line coverage змінених файлів по всіх JS-roots проєкту.
Прогін suite повний (`--passWithNoTests`), але lcov обмежено зміненими
файлами через `--coverage.include` — файли без жодного тесту зʼявляються
в lcov з 0% (vitest 4: явний include замість прибраного `coverage.all`).

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
