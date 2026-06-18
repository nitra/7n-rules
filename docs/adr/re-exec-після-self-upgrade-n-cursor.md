---
type: ADR
title: "Re-exec після self-upgrade у `@nitra/cursor` CLI"
---

# Re-exec після self-upgrade у `@nitra/cursor` CLI

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

`n-cursor` оновлює пакет `@nitra/cursor` на диску під час власного виконання (`upgradeNitraCursorToLatestAndBunInstall`), але ES-модулі вже завантажені у V8-процес і не перезавантажуються. Будь-яка нова логіка (`RULE_MIGRATIONS`, `detectAutoRulesAndSkills`, таблиці міграцій) залишається невидимою для поточного запуску.

## Рішення/Процедура/Факт

У `npm/bin/n-cursor.js` додано функцію `reexecIfPackageVersionChanged(effectivePackageRoot)`, яка викликається в `runSync()` одразу після `upgradeNitraCursorToLatestAndBunInstall`, до `readConfig`. Функція:

1. Виходить при `NITRA_CURSOR_REEXEC === '1'` — захист від нескінченного циклу.
2. Виходить при `effectivePackageRoot === BUNDLED_PACKAGE_ROOT` — реального апгрейду не сталося.
3. Порівнює `version` зі старого та нового `package.json` через `readBundledVersionAt`.
4. Якщо версії відрізняються — виконує `spawnSync(process.execPath, [newBinary, ...argv], { stdio: 'inherit', env: { ...process.env, NITRA_CURSOR_REEXEC: '1' } })`.
5. Завершує поточний процес через `process.exit(result.status ?? 1)`.

Версію бампнуто `1.8.201 → 1.8.202`, запис додано до `npm/CHANGELOG.md`.

## Обґрунтування

Re-exec — єдиний надійний спосіб гарантувати виконання нового коду після self-upgrade. ES-модулі в Node.js кешуються у V8 і не можуть бути перезавантажені в рамках одного процесу. `runChecks` не зачеплено, оскільки він не викликає self-upgrade і версії процесу та пакету там завжди узгоджені.

## Розглянуті альтернативи

`dynamic import()` зі свіжого шляху після апгрейду — відхилено, бо `n-cursor.js` вже виконується з npx-кешу, а не з `node_modules/`. Потрібна саме повна заміна процесу через `spawnSync`.

## Зачіпає

- `npm/bin/n-cursor.js` — функція `reexecIfPackageVersionChanged`, виклик у `runSync`, новий import `spawnSync`
- `npm/package.json` — версія `1.8.202`
- `npm/CHANGELOG.md`

## Knowledge: правило `changelog` вимкнено в `.n-cursor.json`

У `.n-cursor.json` проєкту наявний рядок `"disable-rules": ["changelog"]`, який вимикає правило `changelog` та `check-changelog.mjs` зі списку перевірок при `npx @nitra/cursor check`. Без активного правила асистент не отримує нагадування про обов'язковість bump і запису в CHANGELOG при зміні у workspace — відповідальність лягає на людину або асистента і може бути пропущена.

Зачіпає: `.n-cursor.json` (`disable-rules`), `npm/scripts/check-changelog.mjs`, `AGENTS.md`.
