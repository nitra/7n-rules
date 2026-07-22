---
type: JS Module
title: http-route.mjs
resource: npm/rules/abie/lib/http-route.mjs
docgen:
  crc: d88f96a3
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 75
---

## Огляд

Файл виконує аналітику Cross-документаки abie HTTPRoute для підрахунку кількості посилань на спільні бекенди (`auth-run-hl`, `file-link-hl`) у base-маніфестах пакета, виключаючи оверлей `ua`.

Поведінка
Функції взаємодіють у ланцюжку: `httpRouteDocSharedCrossNsBackendStats` приймає об'єкт та релятивний шлях, перевіряючи, чи відповідає зв'язок із спільними бекендами критеріям, визначеним у `ABIE_SHARED_CROSS_NS_BACKEND_SET`. Результати перевірки (включаючи помилки) збираються для подальшої обробки. Функція `analyzeAbieSharedBackendRefsInPackageK8s` ітерує по всіх YAML-файлах пакета, застосовуючи умову, що виключає оверлей `ua`, та викликає `readAndParseYamlDocs` для завантаження документації. Дані з кожної документації передаються до `httpRouteDocSharedCrossNsBackendStats`, яка, у свою чергу, перевіряє кожне посилання на спільні бекенди, повертаючи статистику та помилки. Ця статистика агрегується у `refCount` та `baseErrors`, які повертаються з `analyzeAbieSharedBackendRefsInPackageK8s`.

## Поведінка

Функції взаємодіють у ланцюжку: `httpRouteDocSharedCrossNsBackendStats` приймає об'єкт та релятивний шлях, перевіряючи, чи відповідає зв'язок із спільними бекендами критеріям, визначеним у `ABIE_SHARED_CROSS_NS_BACKEND_SET`. Результати перевірки (включаючи помилки) збираються для подальшої обробки. Функція `analyzeAbieSharedBackendRefsInPackageK8s` ітерує по всіх YAML-файлах пакета, застосовуючи умову, що виключає оверлей `ua`, та викликає `readAndParseYamlDocs` для завантаження документації. Дані з кожної документації передаються до `httpRouteDocSharedCrossNsBackendStats`, яка, у свою чергу, перевіряє кожне посилання на спільні бекенди, повертаючи статистику та помилки. Ця статистика агрегується у `refCount` та `baseErrors`, які повертаються з `analyzeAbieSharedBackendRefsInPackageK8s`.

## Публічний API

- ABIE_SHARED_CROSS_NS_BACKEND_NAMES — Імена спільних headless-сервісів, на які HTTPRoute-и пакетів посилаються крізь namespace.
- analyzeAbieSharedBackendRefsInPackageK8s — Збирає по yaml-файлах пакета (поза overlay ua) кількість shared-`-hl` `backendRefs`
і базові помилки (без `namespace: dev`).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
