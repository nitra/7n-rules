---
type: JS Module
title: local-providers.mjs
resource: llm-lib/lib/local-providers.mjs
docgen:
  crc: cd7b4cfa
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає стандартну мапу local-провайдерів для `llm_lib::local_cloud` у формі `{ prefix: { baseUrl, apiKey } }`, щоб JS-частина могла передати Rust-крейту готові endpoints для `oneShotLocalCloud` і `submitBatch`. `defaultLocalProviders` завжди описує `omlx` і `litellm` одночасно, а фактичний мережевий запит отримує лише провайдер, чий префікс вибрано в model-spec, наприклад `N_LOCAL_MIN_MODEL`.

## Поведінка

1. `defaultLocalProviders` формує стандартний набір local-провайдерів для `llm_lib::local_cloud`, щоб JS-частина передавала Rust-крейту готову мапу endpoint-ів у спільному форматі.

2. До мапи завжди входять `omlx` і `litellm`; наявність обох записів не означає одночасне використання обох провайдерів.

3. Активним стає лише провайдер, чий префікс вибрано в model-spec, тому запит спрямовується до одного відповідного клієнта.

4. Для `omlx` використовується локальна адреса за замовчуванням `http://127.0.0.1:8000/v1/`, щоб підтримати локальний LLM-сервер без обов’язкової конфігурації.

5. Для `litellm` використовується віддалена адреса за замовчуванням `https://llm.7n.ai/v1/`, щоб мати готовий fallback-провайдер для централізованого LLM endpoint-а.

6. Значення адрес і ключів доступу можуть надходити з оточення, щоб одна й та сама логіка працювала в локальному, CI та production-середовищах без зміни коду.

7. Файл лише збирає конфігурацію провайдерів і не виконує власних операцій запису.

## Сценарії використання

- `llm-lib/tests/local-providers.test.mjs` (defaultLocalProviders) — без env — дефолтні baseUrl для omlx і litellm, apiKey null; обидва провайдери завжди присутні одночасно (жоден не вимикається іншим); N_OMLX_BASE_URL/N_OMLX_API_KEY перекривають дефолт omlx; N_LITELLM_BASE_URL/N_LITELLM_API_KEY перекривають дефолт litellm

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
