---
type: JS Module
title: fix-check.mjs
resource: npm/rules/js/check/fix-check.mjs
docgen:
  crc: e3214d8e
  model: manual
---

## Огляд

T0-autofix для `js/check`: детермінований scaffold/merge `eslint.config.js` за
планом `planEslintConfigFix` (детекція воркспейс-типів node/vue). Раніше ці
порушення йшли у LLM-ладдер, який переписував конфіг цілком і вгадував типи
(інцидент: у vue-монорепо записано `getConfig({ node: ['npm'] })` — eslint перестав
обробляти .vue файли).

## Поведінка

- Патерн `js-check-eslint-config` тригериться лише на reason-и
  `eslint-config-missing` / `eslint-config-ignores` / `eslint-config-vue-workspace`;
  решта порушень `js/check` (engines, workflows, oxlintrc) ідуть стандартним шляхом.
- `apply` перераховує план із поточного стану диска (ідемпотентно): відсутній
  конфіг — створюється з детектованими типами; наявний — зазнає хірургічного merge,
  без повного перезапису. Перед записом викликається `ctx.recordWrite`.
- Якщо план порожній (`null`) — жодних змін (`touchedFiles: []`).

## Гарантії поведінки

- Записує лише один файл — `eslint.config.js`/`eslint.config.mjs` у корені репо.
- Наявний конфіг ніколи не перезаписується цілком — тільки точкові вставки/заміни.
