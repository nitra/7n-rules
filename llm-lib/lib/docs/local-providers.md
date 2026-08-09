---
type: JS Module
title: local-providers.mjs
resource: llm-lib/lib/local-providers.mjs
docgen:
  crc: 15c41965
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Повертає default map `defaultLocalProviders` для `llm_lib::local_cloud`, яка дає контракт `{ prefix: { baseUrl, apiKey } }` для `oneShotLocalCloud` і `submitBatch`.

Головний слот `local-openai` призначений для будь-якого кастомного OpenAI-сумісного локального сервера через спільний `N_LOCAL_OPENAI_*`-env і `N_LOCAL_OPENAI_BASE_URL` для перемикання між серверами без окремих env-пар на кожен backend.

Це свідомий breaking change: `omlx/...` більше не резолвиться, а всі конфіги мають мігрувати на `local-openai/...` (`nitra/7n-rules#374`).

Запис саме `openai` тут не використовується, щоб не перехопити справжні хмарні виклики на кшталт `openai/gpt-5.4-mini` у `llm_lib::local_cloud` і genai, де цей prefix означає cloud OpenAI, а не локальний сервер.

## Поведінка

1. `defaultLocalProviders` повертає стандартну мапу для локального OpenAI-сумісного провайдера `local-openai`, яку використовує `llm_lib::local_cloud` для викликів на локальні моделі.
2. За замовчуванням вона спрямовує запити на локальний сервер без зовнішніх залежностей: `http://127.0.0.1:8000/v1/`.
3. Якщо задано `N_LOCAL_OPENAI_BASE_URL`, функція підставляє його як цільовий endpoint; якщо задано `N_LOCAL_OPENAI_API_KEY`, функція передає його як ключ доступу.
4. Якщо локальні змінні середовища не задані, функція залишає безпечні дефолти: локальний baseUrl і відсутній apiKey.
5. `defaultLocalProviders` навмисно не реєструє окремі записи для інших локальних серверів і не підтримує паралельне перемикання між ними через різні tier-env; для цього використовується один спільний слот `local-openai`.
6. `defaultLocalProviders` навмисно не використовує prefix `openai`, щоб не перехоплювати справжні cloud-виклики до хмарного OpenAI.

## Сценарії використання

- `llm-lib/tests/local-providers.test.mjs` (defaultLocalProviders) — без env — один запис local-openai з дефолтним локальним baseUrl, apiKey null; N_LOCAL_OPENAI_BASE_URL/N_LOCAL_OPENAI_API_KEY перекривають дефолт — незалежно від того, який сервер за ним стоїть (omlx, litellm, turbofieldfare, ...); лише один провайдер зареєстрований — перемикання між серверами відбувається переналаштуванням N_LOCAL_OPENAI_BASE_URL, не одночасним співіснуванням

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
