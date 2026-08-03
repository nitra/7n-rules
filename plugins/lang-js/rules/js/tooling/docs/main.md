---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/js/tooling/main.mjs
docgen:
  crc: 073b19ff
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 95
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
  порушень `.oxlintrc.json` (відсутній файл / розходження з каноном).
- `KNIP_MISSING` — reason-код відсутнього `knip.json`. До 2026-08-01 такого
  порушення не існувало: детектор `js/check` сам копіював канон під час
  detect і звітував `pass` (спека
  `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення Ґ).
- `verifyOxlintRcAgainstCanonical(cfg, canonical)` вимагає точний збіг
  canonical rules, але дозволяє project-specific `rules`, `ignorePatterns`
  та `jsPlugins`; кожен canonical plugin однаково лишається обов'язковим.
- `planOxlintrcFix(actual, canonical)` доповнює canonical значення без
  втрати локальних розширень, тому локальний Oxlint wrapper переживає T0 fix.

## Публічний API

- `OXLINT_CANONICAL_JSON_PATH` / `KNIP_CANONICAL_JSON_PATH` — шляхи до canonical JSON.
- `OXLINTRC_MISSING` / `OXLINTRC_DRIFT` — reason-коди порушень `.oxlintrc.json`.
- `KNIP_MISSING` — reason-код відсутнього `knip.json` (T0 `js-check-knip`).
- `verifyOxlintRcAgainstCanonical(cfg, canonical)` → `{ ok, failures }` — перевірка конфігу.
- `planOxlintrcFix(actual, canonical)` → злитий `.oxlintrc.json` для T0-фіксу.

## Гарантії поведінки

- Модуль не виконує записів у ФС; запис конфігу виконує `fix-check.mjs`.
- `planOxlintrcFix` є чистою та детермінованою функцією.
