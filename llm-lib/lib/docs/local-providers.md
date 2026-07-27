---
type: JS Module
title: local-providers.mjs
resource: llm-lib/lib/local-providers.mjs
docgen:
  crc: 6513b04f
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дефолтна мапа local-провайдерів для `llm_lib::local_cloud` у форматі `{ prefix: { baseUrl, apiKey } }`, яку споживають `oneShotLocalCloud` і `submitBatch`.

`omlx` і `litellm` завжди присутні в мапі одночасно, а фактичний виклик іде рівно в один клієнт за `provider`-префіксом у model-spec. Якщо spec не вказує на певний префікс, відповідний запис у мапі не отримує запиту.

## Поведінка

1. `defaultLocalProviders` формує єдиний дефолтний набір local-провайдерів для `llm_lib::local_cloud`, щоб обидва зареєстровані напрямки — `omlx` і `litellm` — були доступні одночасно в очікуваному `{ prefix: { baseUrl, apiKey } }` форматі для `oneShotLocalCloud` і `submitBatch`.
2. Для `omlx` функція бере `baseUrl` з `N_OMLX_BASE_URL`, а якщо його немає — підставляє `http://127.0.0.1:8000/v1/`; `apiKey` бере з `N_OMLX_API_KEY`, інакше лишає порожнім значенням.
3. Для `litellm` функція бере `baseUrl` з `N_LITELLM_BASE_URL`, а якщо його немає — підставляє `https://llm.7n.ai/v1/`; `apiKey` бере з `N_LITELLM_API_KEY`, інакше лишає порожнім значенням.
4. Функція не вирішує, який провайдер “активний” сама по собі: вибір фактично визначається тим, який provider-префікс вказаний у model-spec на кшталт `N_LOCAL_MIN_MODEL`.
5. Коли model-spec вказує на один префікс, `LocalCloud::one_shot_with_spec` звертається рівно до відповідного клієнта; другий запис у мапі залишається запасним і не отримує запитів, доки жоден spec на нього не посилається.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
