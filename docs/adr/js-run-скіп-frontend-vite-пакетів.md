# Скіп frontend-пакетів у check-js-run

**Status:** Accepted
**Date:** 2026-05-05

## Контекст

Правило `js-run.mdc` мало `alwaysApply: true` і пропонувало заміну `process.env.X` → `import { env } from 'node:process'`. LLM-агент застосував це до `site/src/main.js` у frontend-пакеті (Vue/Vite SPA), де `node:process` resolve'иться у `undefined` у браузерному бандлі. Паралельно `check-js-run.mjs` сканував frontend-workspace-и і репортив хибні порушення, які розробник не міг коректно усунути.

## Рішення/Процедура/Факт

1. `npm/mdc/js-run.mdc` (v1.1 → v1.2): додано секцію **«Область застосування»** — явно описує, що правило стосується виключно backend Node.js workspace-пакетів; frontend-маркер: наявність `vite` у `devDependencies`.
2. `npm/scripts/check-js-run.mjs`: додано хелпер `packageJsonHasViteDevDependency(pkgJson)` та ранній вихід у `checkWorkspacePackage` — якщо пакет є frontend (vite у devDeps), весь скан `process.env`, `#conn/*`, OTEL configmap пропускається.
3. `npm/tests/check-js-run-fixture.test.mjs`: 2 нові тести — vite-пакет з `process.env.NODE_ENV` → `check()` повертає 0; non-vite пакет із тим же кодом → повертає 1.
4. Версія: 1.8.179 → 1.8.180.

## Обґрунтування

Семантика frontend-маркера (`vite` у `devDependencies`) вже існувала в `auto-rules.mjs` для вирішення, чи додавати правило `js-run` на рівні монорепо. Повний skip (а не частковий) обрано як простіший підхід: bunyan, `#conn/*`-аліаси та OTEL configmap неактуальні для frontend-пакетів за визначенням.

## Розглянуті альтернативи

Частковий skip — пропускати лише скан `process.env` і conn-imports, але залишати bunyan та OTEL. Відхилено як надмірно ускладнений без практичної вигоди.

## Зачіпає

`npm/mdc/js-run.mdc`, `npm/scripts/check-js-run.mjs`, `npm/tests/check-js-run-fixture.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
