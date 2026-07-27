---
type: JS Module
title: clover.mjs
resource: plugins/lang-php/coverage-provider/clover.mjs
docgen:
  crc: f65037a1
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Регексп-парс PHPUnit/Pest clover-звіту (`--coverage-clover`) без зовнішньої
XML-залежності: у репозиторії немає жодної (перевірено — `xml`/DOM-парсер
ніде не використовується), а clover-діалект стабільний і простий — кожен
`<file>` містить (опційно) class-рівня `<metrics>`, потім `<line>`-записи, і
завершується власним file-рівня `<metrics .../>` (self-closing, без
вкладеного тексту) — саме він дає file totals. Дзеркалить контракт
`lcov.mjs` ядра (`parseLcovTotals`/`parseLcovPerFile`), але лишається у
плагіні: спільна lib концерну coverage — не мандат цієї задачі (не чіпати
core).

## Поведінка

parseCloverTotals повертає зведення лише з file-рівня `metrics`; якщо вхід не містить придатних `file`-блоків, обидва лічильники лишаються нульовими. Результат стабільно має дві групи: lines і functions, без додаткових полів.

parseCloverPerFile повертає по одному запису на кожен файл із clover, для якого є file-рівня `metrics`. Якщо покриття для рядків у файлі дорівнює нулю, відсоток вважається 100. Шляхи зберігаються як у звіті; rebasing відносно cwd тут не виконується.

## Публічний API

- parseCloverTotals — Агрегує lines/functions totals по всіх файлах clover-звіту: `statements`/
`coveredstatements` → lines, `methods`/`coveredmethods` → functions.
- parseCloverPerFile — Per-file рядкове покриття з clover (`file`/`pct`/`linesFound`/`linesCovered`
— та сама форма, що `parseLcovPerFile` ядра; шляхи — як у `name`-атрибуті
clover, рібейзинг відносно cwd — на боці провайдера).

## Сценарії використання

- `plugins/lang-php/coverage-provider/tests/clover.test.mjs` (parseCloverTotals; parseCloverPerFile) — агрегує lines/functions по всіх файлах (сума file-рівня metrics); порожній звіт → нулі; per-file рядки з pct, беруть file-рівня (останній) <metrics>, не class-рівня; файл без statements (0 рядків) → pct 100

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
