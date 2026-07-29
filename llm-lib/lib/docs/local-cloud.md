---
type: JS Module
title: local-cloud.mjs
resource: llm-lib/lib/local-cloud.mjs
docgen:
  crc: cedae6fe
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тип 2a (OpenAI-сумісний API, sync) для Node — прямий HTTP до OpenAI-compatible
ендпоінта (`chat/completions`): локальні провайдери (напр. omlx) і хмарні
(стандартна автентифікація провайдера) — без агентського циклу.

Тонкий JS-клієнт до Rust-крейта `llm_lib::local_cloud` через napi FFI
in-process (`llm-lib/crates/llm-lib-napi`) — жодного власного HTTP-клієнта
тут (анти-приклад, якого це уникає: `mlmail` читає `~/.omlx/settings.json`
і б'є в ендпоінт напряму замість спільної точки, задача T5/рішення Н).

## Публічний API

- oneShotLocalCloud — Один chat-виклик Типу 2a. `modelSpecOrTier` — явний `"provider/model-id"`,
абстрактний tier або `N_LOCAL_*_MODEL`/`N_CLOUD_*_MODEL` selector
через ту саму [`llm_lib::resolve_model`], що й `resolveModel` з
`model-tiers.mjs`.

## Сценарії використання

- `llm-lib/tests/local-cloud.test.mjs` (oneShotLocalCloud) — делегує modelSpecOrTier/prompt у native.oneShotLocalCloud і віддає його результат; явний; localProviders і system прокидаються в options; без опцій (лише modelSpecOrTier/prompt) — localProviders/system undefined

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
