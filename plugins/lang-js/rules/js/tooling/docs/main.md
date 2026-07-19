---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/js/tooling/main.mjs
docgen:
  crc: 76437b89
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Шляхи до канонічних JSON-конфігурацій для `oxlint` та `knip` доступні через
`OXLINT_CANONICAL_JSON_PATH` та `KNIP_CANONICAL_JSON_PATH`. Модуль перевіряє,
чи відповідає `.oxlintrc.json` канону (`verifyOxlintRcAgainstCanonical`), і
будує детермінований merge до канону (`planOxlintrcFix`) — джерело правди для
T0-автофіксу `js/check` (`fix-check.mjs`), без LLM.

## Поведінка

- `OXLINT_CANONICAL_JSON_PATH` / `KNIP_CANONICAL_JSON_PATH` — шляхи до
  канонічних JSON-конфігів `oxlint`/`knip` у цьому пакеті.
- `OXLINTRC_MISSING` / `OXLINTRC_DRIFT` — стабільні reason-коди для
  порушень `.oxlintrc.json` (відсутній файл / розходження з каноном),
  які `js/check` проставляє через `createViolationReporter`, а T0-патерн
  `js-check-oxlintrc` розпізнає для автофіксу.
- `verifyOxlintRcAgainstCanonical(cfg, canonical)` — звіряє `.oxlintrc.json`
  проти канону: усі `rules`-ключі канону мають точний збіг значення (зайві
  локальні ключі дозволені), `ignorePatterns` канону мають бути присутні
  (локальні розширення дозволені), решта полів — точний глибокий збіг.
- `planOxlintrcFix(actual, canonical)` — чиста функція, що дзеркалить
  правила `verifyOxlintRcAgainstCanonical` у зворотний бік: будує обʼєкт
  `.oxlintrc.json`, який гарантовано проходить повторну перевірку.
  Відсутній `actual` (`null`) трактується як порожній файл — результат
  дорівнює канону. Наявний `actual` доповнюється до канону без втрати
  project-specific розширень: зайві `rules`-ключі й `ignorePatterns`
  зберігаються, а канонічні `rules`-значення й поля верхнього рівня
  перезаписуються канонічними (єдине валідне значення для перевірки).

## Публічний API

- `OXLINT_CANONICAL_JSON_PATH` — шлях до канонічного конфігу `oxlint` для перевірки/T0-фіксу.
- `KNIP_CANONICAL_JSON_PATH` — шлях до канонічного конфігу `knip`, що копіюється у корінь проєкту-споживача, якщо відсутній.
- `OXLINTRC_MISSING` / `OXLINTRC_DRIFT` — reason-коди порушень `.oxlintrc.json`.
- `verifyOxlintRcAgainstCanonical(cfg, canonical)` → `{ ok, failures }` — перевірка `.oxlintrc.json` проти канону.
- `planOxlintrcFix(actual, canonical)` → злитий обʼєкт `.oxlintrc.json` — детермінований T0-фікс без LLM.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД); запис у `.oxlintrc.json` — відповідальність виклику (T0 `fix-check.mjs`).
- `planOxlintrcFix` — чиста функція без side effects; той самий вхід завжди дає той самий вихід.
