---
type: JS Module
title: http-route.mjs
resource: npm/rules/abie/lib/http-route.mjs
docgen:
  crc: 3ec544d6
---

Файл надає інструмент для порівняльного аналізу конфігурації HTTP-маршрутів. Він виконує порівняння кількості `backendRefs` для сервісів `auth-run-hl` та `file-link-hl` у базових маніфестах пакета з кількістю патчів, визначеною в оверлеях. Цей механізм використовується для синхронізації кількості патчів у верхньому рівні з фактичною кількістю посилань у базі. (abie.mdc)

## Поведінка

ABIE_SHARED_CROSS_NS_BACKEND_NAMES
Визначає список спільних сервісів, які підлягають аналітиці.

analyzeAbieSharedBackendRefsInPackageK8s
Збирає кількість посилань на спільні бекенди та порушення вимог до namespace у базових документах HTTPRoute пакета.

## Публічний API

ABIE_SHARED_CROSS_NS_BACKEND_NAMES — Формує імена для крос-нішових зв'язків між бекендами. (abie.mdc)

analyzeAbieSharedBackendRefsInPackageK8s — Збирає кількість спільних посилань `backendRefs` та базові помилки з YAML-файлів пакета, ігноруючи неймспейс `dev`. (abie.mdc)

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
