---
type: JS Module
title: fix-eslint.mjs
resource: plugins/lang-js/rules/js/eslint/fix-eslint.mjs
docgen:
  crc: 07b6b2a1
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 55
  issues: no-overview,short-behavior,best-of-2:retry-lost
---

## Сценарії використання

- `plugins/lang-js/rules/js/eslint/tests/fix-eslint.test.mjs` (js-eslint-autofix pattern; js-eslint-mechanical-text-fix pattern) — 2 патерни, перший — очікуваний id; test: true коли є violation з file; test: false коли violations без file; apply: лише не-js файли → лінтери не запускаються, touchedFiles порожній; apply: js-файл, bunx резолвиться → spawnSync з абсолютним шляхом резолвлений через resolveCmd; ще 8

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
