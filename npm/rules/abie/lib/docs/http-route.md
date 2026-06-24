---
type: JS Module
title: http-route.mjs
resource: npm/rules/abie/lib/http-route.mjs
docgen:
  crc: 1ffd9c0b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Виконує крос-документну аналітику для підрахунку `backendRefs` до спільних сервісів (`auth-run-hl`, `file-link-hl`) у base-маніфестах пакета, що знаходяться поза overlay `ua`. Використовується фіксований список спільних сервісів, визначений через `ABIE_SHARED_CROSS_NS_BACKEND_NAMES`. Функція `analyzeAbieSharedBackendRefsInPackageK8s` підраховує ці посилання. Це забезпечує синхронізацію числа патчів namespace в overlay із кількістю base-reference, використовуючи `ua_http_route-концерном` для забезпечення узгодженості (abie.mdc).

## Поведінка

ABIE_SHARED_CROSS_NS_BACKEND_NAMES надає фіксований список назв спільних сервісів (`auth-run-hl`, `file-link-hl`), які підлягають аналізу.
analyzeAbieSharedBackendRefsInPackageK8s збирає кількість посилань на спільні сервіси (`backendRefs`) у base-маніфестах пакета (виключаючи overlay `ua`) та виявляє порушення вимог до цих посилань (наприклад, відсутність `namespace: dev` або `port: 8080` (abie.mdc)).

## Публічний API

ABIE_SHARED_CROSS_NS_BACKEND_NAMES — Визначає імена бекендів, що використовуються між різними неймспейсами.
analyzeAbieSharedBackendRefsInPackageK8s — Підраховує кількість посилань на спільні бекенди у YAML-файлах пакета (крім overlay ua) та фіксує базові помилки (без неймспейсу dev). (abie.mdc)

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
