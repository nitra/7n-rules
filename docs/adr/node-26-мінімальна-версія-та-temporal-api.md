---
type: ADR
title: "Мінімальна версія Node.js ≥ 26 та використання Temporal API"
---

# Мінімальна версія Node.js ≥ 26 та використання Temporal API

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

Вийшов Node.js 26 з офіційним включенням Temporal API без прапорів та іншими нативними вдосконаленнями. Проєкт `n-cursor` не потребує зворотної сумісності з попередніми версіями Node.js.

## Рішення/Процедура/Факт

Мінімальну версію Node.js підвищено до `>=26` у полях `engines` у `package.json` (root + workspaces `demo`, `npm`) та `.nvmrc`/`.node-version`. Замість legacy `new Date()` / `Date.now()` використовується `Temporal` API (нативний, без поліфілів). Нативний `fetch`, `streams`, оновлений `fs`/`path` використовуються без поліфілів.

## Обґрунтування

Temporal API під прапором у Node.js 22/24 і потребує поліфілу `@js-temporal/polyfill`. У Node.js 26 — нативний без прапорів. Оскільки зворотна сумісність не потрібна, будь-які runtime-поліфіли можна прибрати.

## Розглянуті альтернативи

Залишити `>=22` або `>=24` — відхилено: Temporal API там ще під прапором і потребує поліфілу.

## Зачіпає

`package.json` (root + workspaces `demo`, `npm`), `.nvmrc`, `.node-version`, `.cursor/rules/n-js-run.mdc` (довідкові вимоги до Node-версії), будь-який код що використовує `new Date()`.

## Update 2026-06-03

Bun `1.3.14` у поточному runtime не має глобального `Temporal` (`typeof Temporal === "undefined"`), а команди проєкту запускаються через Bun. Тому правило `js-run` забороняє identifier `Temporal` у backend/Bun runtime-коді до появи підтримки в Bun. Для форматування часу використовуємо сумісний `Date` API або передаємо timestamp у чисті функції через параметр.
