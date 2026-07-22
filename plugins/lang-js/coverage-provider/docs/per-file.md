---
type: JS Module
title: per-file.mjs
resource: plugins/lang-js/coverage-provider/per-file.mjs
docgen:
  crc: 56a3c64a
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: internal-name:quickClassify,judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл збирає per-file line coverage для delta-gate тестів: `collectPerFile` формує набір змінених JS/TS-файлів, `parseLcovPerFile` зчитує покриття по кожному файлу, а `parseFailingTests` співвідносить провалені тести з цим набором. До гейту потрапляють лише файли, для яких `quickClassify` визначив `needsTests:true`; файли з `needsTests:false` виключаються, а неоднозначні `null` лишаються в гейті консервативно. `.vue` у дельті не гейтиться, бо його покриття рахує browser-mode Storybook-вимір, який для швидкого шляху не запускається. Для цього шляху потрібен project-local `vitest` через `bunx vitest`; `@7n/test` тут не використовується.

## Поведінка

parseFailingTests готує короткий список проблемних тест-файлів, щоб collectPerFile міг доповнювати гейт не лише числом покриття, а й причиною падіння тестового прогону. collectPerFile бере змінені файли, відсікає ті, що не підлягають deltas-gate, і для решти запускає project-local vitest із coverage так, щоб вимірювались лише цільові зміни; для цього воно спирається на package.json і очікує vitest як залежність проєкту. Далі результат coverage зводиться через parseLcovPerFile у per-file рядки, де кожен файл отримує частку покриття, кількість знайдених рядків і кількість покритих рядків. Якщо тестовий прогін не дає даних або файл не є кандидатом на гейт, collectPerFile повертає для нього reason замість coverage-метрик. `.vue`-файли в цьому шляху свідомо не гейтяться, бо їхнє покриття рахується окремим browser-mode виміром, а файли, яким тести не потрібні, у гейт не потрапляють; неоднозначні випадки лишаються в перевірці консервативно.

## Публічний API

- parseLcovPerFile — Парс lcov.info у per-file рядки (`SF:`/`LF:`/`LH:`).
- parseFailingTests — Парсить JSON-звіт vitest у список падаючих тест-файлів з короткими помилками
  (вхід fix-шляху `fix/fix-tests.mjs`; перенесено з coverage-per-file `@7n/test`).
- collectPerFile — Міряє per-file line coverage змінених файлів по всіх JS-roots проєкту.
  Прогін suite повний (`--passWithNoTests`), але lcov обмежено зміненими
  файлами через `--coverage.include` — файли без жодного тесту зʼявляються
  в lcov з 0% (vitest 4: явний include замість прибраного `coverage.all`).

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
