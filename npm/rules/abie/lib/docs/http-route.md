---
type: JS Module
title: http-route.mjs
resource: npm/rules/abie/lib/http-route.mjs
docgen:
  crc: d88f96a3
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`analyzeAbieSharedBackendRefsInPackageK8s` рахує `backendRefs` у base-маніфестах пакета, що вказують на спільні cross-namespace `-hl` сервіси з набору `ABIE_SHARED_CROSS_NS_BACKEND_NAMES`, і не враховує overlay `ua`. Це дає `ua_http_route` змогу синхронізувати кількість namespace patch-ів в overlay із фактичною кількістю base-reference до shared backend.

## Поведінка

ABIE_SHARED_CROSS_NS_BACKEND_NAMES задає спільний перелік cross-namespace `-hl` сервісів, на який орієнтується вся перевірка; цей набір використовується як єдине джерело істини для того, що вважається shared backend.

analyzeAbieSharedBackendRefsInPackageK8s проходить по YAML-маніфестах пакета в base-шарі, свідомо оминаючи overlay `ua`, і збирає лише ті HTTPRoute-документи, які реально посилаються на спільні сервіси. Для кожного такого посилання воно підсумовує кількість `backendRefs` і накопичує порушення, якщо shared backend вказано не через `namespace: dev` або без очікуваного `port: 8080` згідно з (abie.mdc).

Результат роботи повертається як агрегована статистика для подальшої синхронізації кількості namespace-patch-ів в overlay із фактичною кількістю base-reference; помилки повертаються окремим списком, щоб викликальний концерн міг показати саме ті місця, де базовий HTTPRoute виходить за правилами shared cross-namespace доступу.

## Публічний API

- ABIE_SHARED_CROSS_NS_BACKEND_NAMES — Імена спільних headless-сервісів, на які HTTPRoute-и пакетів посилаються крізь namespace.
- analyzeAbieSharedBackendRefsInPackageK8s — Збирає по yaml-файлах пакета (поза overlay ua) кількість shared-`-hl` `backendRefs`
і базові помилки (без `namespace: dev`).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
