---
type: JS Module
title: http-route.mjs
resource: npm/rules/abie/lib/http-route.mjs
docgen:
  crc: c3626280
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл здійснює крос-документну аналітику HTTPRoute, використовуючи `ABIE_SHARED_CROSS_NS_BACKEND_NAMES` та `analyzeAbieSharedBackendRefsInPackageK8s`. Він підраховує кількість посилань на спільні сервіси (`auth-run-hl`, `file-link-hl`) у base-маніфестах пакета, ігноруючи overlay `ua`. Мета полягає у синхронізації числа `patch`-ів namespace в overlay з кількістю base-reference, що гарантує узгодженість конфігурації (abie.mdc).

## Поведінка

Поведінка:
ABIE_SHARED_CROSS_NS_BACKEND_NAMES: Надає список назв спільних сервісів (`auth-run-hl`, `file-link-hl`), до яких здійснюється аналіз.
analyzeAbieSharedBackendRefsInPackageK8s: Підраховує кількість посилань на спільні сервіси (`auth-run-hl`, `file-link-hl`) у base-маніфестах пакета, що знаходяться поза overlay `ua`, і виявляє порушення вимог конфігурації, використовуючи маркер (abie.mdc).

## Публічний API

ABIE_SHARED_CROSS_NS_BACKEND_NAMES — Список імен бекендів, які знаходяться в загальному просторі імен (cross-namespace) для спільного використання.
analyzeAbieSharedBackendRefsInPackageK8s — Підраховує у YAML-файлах пакета (за винятком overlay ua) кількість посилань на shared-hl backendRefs та виявляє базові помилки (за винятком namespace: dev).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
