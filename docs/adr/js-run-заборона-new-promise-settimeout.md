---
type: ADR
title: "Заборона new Promise для пауз у Node.js бекенд-пакетах"
---

# Заборона new Promise для пауз у Node.js бекенд-пакетах

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

У backend-пакетах траплявся патерн `await new Promise(resolve => setTimeout(resolve, ms))` для реалізації затримок — багатослівний boilerplate, коли Node.js має вбудовану промісну версію `setTimeout` у стандартній бібліотеці.

## Рішення/Процедура/Факт

1. `npm/mdc/js-run.mdc` (v1.3 → v1.4): секція **«Паузи через setTimeout»** забороняє `await new Promise(resolve => setTimeout(resolve, ms))`, вимагає натомість:
   ```js
   import { setTimeout } from 'node:timers/promises';
   await setTimeout(ms);
   ```
2. Новий AST-сканер `npm/scripts/utils/promise-settimeout-scan.mjs` на базі oxc-parser — виявляє заборонений патерн: `new Promise` з колбеком що містить `setTimeout(resolve, ...)`.
3. Сканер інтегровано в `npm/scripts/check-js-run.mjs` — `npx @nitra/cursor check js-run` фейлить при знаходженні патерну.
4. 13 юніт-тестів (`npm/tests/promise-settimeout-scan.test.mjs`) та інтеграційні фікстури в `npm/tests/check-js-run-fixture.test.mjs`.
5. Версія: 1.8.185 → 1.8.186.

## Обґрунтування

`node:timers/promises` — стандартна бібліотека Node.js (з v15). Промісна обгортка `new Promise(...)` є зайвим шаблонним кодом без будь-яких переваг. Правило зберігається в `.mdc`, а не тільки в пам'яті асистента.

## Розглянуті альтернативи

Зберегти лише як memory-нотатку асистента — відхилено: правило має бути в `.mdc` для фіксації в кодовій базі та перевірки через `check`.

## Зачіпає

`npm/mdc/js-run.mdc`, `npm/scripts/utils/promise-settimeout-scan.mjs` (новий), `npm/scripts/check-js-run.mjs`, `npm/tests/promise-settimeout-scan.test.mjs` (новий), `npm/tests/check-js-run-fixture.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
