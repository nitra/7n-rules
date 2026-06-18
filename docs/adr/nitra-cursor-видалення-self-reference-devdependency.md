---
type: ADR
title: "Видалення self-reference devDependency `@nitra/cursor` з `npm/package.json`"
---

# Видалення self-reference devDependency `@nitra/cursor` з `npm/package.json`

**Status:** Accepted
**Date:** 2026-05-16

## Контекст

`npm/package.json` містив `devDependencies: {"@nitra/cursor": "^1.11.9"}` — pinned self-reference на власний пакет із зафіксованою версією. Водночас кореневий `package.json` підключав той самий пакет через `workspace:*`. Паралельно `knip.json` мав запис `ignoreDependencies: ["@nitra/cursor"]` як workaround — він приховував діагностику Knip замість усунення першопричини.

## Рішення/Процедура/Факт

Видалено блок `devDependencies` з `npm/package.json` (версія `@nitra/cursor` 1.11.14). Прибрано `ignoreDependencies: ["@nitra/cursor"]` з `knip.json`. Після `bun i` встановлено 1 пакет без помилок.

## Обґрунтування

Pinned self-reference вимагав ручного оновлення після кожного bump версії або вказував на застарілу версію під час розробки. `ignoreDependencies` у Knip — ознака «прикритої» проблеми: Knip виявляв незрозумілу залежність, і замість виправлення її замовчували через конфіг.

## Розглянуті альтернативи

- Замінити pinned версію на `workspace:*` безпосередньо в `npm/package.json` — відхилено, оскільки кореневий `package.json` вже має правильне підключення через `workspace:*` і окремий запис у `npm/package.json` зайвий.
- Залишити з автосинхронізацією при bump — відхилено як крихке рішення, що потребує додаткового tooling або ручного контролю.

## Зачіпає

`npm/package.json` (видалено блок `devDependencies`), `knip.json` (видалено `ignoreDependencies: ["@nitra/cursor"]`)
