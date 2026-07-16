---
type: JS Module
title: fix-check.mjs
resource: npm/rules/js/check/fix-check.mjs
docgen:
  crc: 48182147
  model: manual
---

## Огляд

T0-autofix для `js/check`: два детерміновані патерни, обидва без LLM.

- `js-check-eslint-config` — scaffold/merge `eslint.config.js` за планом
  `planEslintConfigFix` (детекція воркспейс-типів node/vue). Раніше ці
  порушення йшли у LLM-ладдер, який переписував конфіг цілком і вгадував типи
  (інцидент: у vue-монорепо записано `getConfig({ node: ['npm'] })` — eslint
  перестав обробляти .vue файли).
- `js-check-oxlintrc` — scaffold/merge `.oxlintrc.json` за планом
  `planOxlintrcFix` (`../tooling/main.mjs`). Раніше ці порушення теж йшли у
  LLM-ладдер: 15 КБ канону дешева модель не відтворює byte-perfect (verify
  fail), а дорожча не встигає за один rung-таймаут.

## Поведінка

- `js-check-eslint-config` тригериться на reason-и `eslint-config-missing` /
  `eslint-config-ignores` / `eslint-config-vue-workspace`. `apply` перераховує
  план із поточного стану диска (ідемпотентно): відсутній конфіг —
  створюється з детектованими типами; наявний — зазнає хірургічного merge, без
  повного перезапису. Якщо план порожній (`null`) — жодних змін
  (`touchedFiles: []`).
- `js-check-oxlintrc` тригериться на reason-и `oxlintrc-missing` /
  `oxlintrc-drift` (`OXLINTRC_MISSING` / `OXLINTRC_DRIFT` з `../tooling/main.mjs`).
  `apply` читає наявний `.oxlintrc.json` (`null`, якщо відсутній або невалідний
  JSON) і канон, будує злитий обʼєкт через `planOxlintrcFix` і перезаписує
  файл цілком (JSON, 2-space, з кінцевим переносом рядка).
- Решта порушень `js/check` (engines, workflows) — поза цим T0, стандартний
  шлях (ladder/manual).
- Обидва патерни викликають `ctx.recordWrite` перед записом (pre-image для
  central rollback).

## Гарантії поведінки

- `js-check-eslint-config` записує лише `eslint.config.js`/`eslint.config.mjs`
  у корені репо; наявний конфіг ніколи не перезаписується цілком — тільки
  точкові вставки/заміни.
- `js-check-oxlintrc` записує лише `.oxlintrc.json` у корені репо; результат
  завжди проходить `verifyOxlintRcAgainstCanonical` без ручного втручання.
