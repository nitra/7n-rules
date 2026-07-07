---
type: ADR
title: Спрощення tier-routing у docgen
description: Docgen прибирає Haiku-рефері, додає timeout локальної генерації, повертає використану модель і переводить Tier 2 на глобальні тири через pi.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

`npm/skills/docgen/js/docgen-gen.mjs` мав складний routing: local Tier 1, det-scorer, Haiku як cloud-рефері для borderline-файлів і Tier 2 через Anthropic SDK. Haiku-виклик додавав вартість і latency, але емпіричний прогін показав, що з 52 local-файлів жоден не перетнув поріг ескалації 70. Також batch-summary не міг показати, яка модель фактично згенерувала документ, бо `generateDoc` не повертав поле `model`.

Окремо `docgen-gen.mjs` хардкодив локальну й cloud-модель та використовував `new Anthropic()` напряму, тоді як у репозиторії вже зафіксовано глобальні тири моделей у `npm/lib/models.mjs` і провайдер-нейтральний transport через `pi`.

## Considered Options

- Залишити Haiku як рефері для `sym ∈ [2, 4)`.
- Замінити Haiku на просту перевірку «не порожній» / timeout.
- Прибрати Haiku повністю, залишити det-scorer і timeout як gate перед Tier 2.
- Не додавати `model` у return value `generateDoc`.
- Додати `model` до return value `generateDoc`.
- Зберегти Anthropic SDK, але підставляти тири з `models.mjs` і стрипати provider-prefix.
- Перейти на `pi`-транспорт як у `llm-worker.mjs`.

## Decision Outcome

Chosen option: "Прибрати Haiku, залишити det-scorer + timeout, повертати model і використовувати pi-транспорт", because Haiku не ескалував жодного файлу на реальних даних, det-scorer ловить структурні проблеми без токенів, timeout дає верхню межу локальної генерації, поле `model` робить звітність точною, а `pi --model provider/model-id` відповідає глобальним тирам моделей.

### Consequences

- Good, because вилучено Haiku-виклики, їхню вартість і latency.
- Good, because локальна генерація не може заблокувати batch безкінечно: timeout ескалує файл у Tier 2.
- Good, because batch-summary може показувати модель у кожному рядку прогресу і розрізняти Tier 1 success, Tier 1 → Tier 2 escalation та pre-routing у Tier 2.
- Good, because `CLOUD_AVG` і `LOCAL_MIN` налаштовуються один раз у середовищі, а docgen підтримує per-skill overrides.
- Bad, because `piOneShot` реалізовано через `spawnSync`, тобто cloud-виклик блокує event loop; transcript не містить підтвердження, що це проблема для batch-сценарію.
- Bad, because якщо local модель поверне структурно коректний, але семантично хибний результат зі score вище порогу, det-scorer може не ескалювати його.

## More Information

- Основний файл: `npm/skills/docgen/js/docgen-gen.mjs`.
- Видалено: `BORDERLINE_SYM_LOW`, `cloudScoreDoc`, `scoreModel`, `scoreCloud`, `import Anthropic from '@anthropic-ai/sdk'`.
- Додано: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`, `withTimeout()`, `piOneShot()`, поле `model` у return-обʼєктах.
- Local model: `env.N_CURSOR_DOCGEN_MODEL ?? LOCAL_MIN`.
- Cloud model: `env.N_CURSOR_DOCGEN_CLOUD_MODEL ?? CLOUD_AVG`.
- `localModelId()` знімає `ollama/` prefix для прямого HTTP-виклику ollama.
- `piOneShot` викликає `pi -p <prompt> --model <model> --no-session --mode text`.
- Перевірка доступності cloud відбувається через непорожній `cloudModel`, а не через `ANTHROPIC_API_KEY`.
- Commits із transcript: `668d1877` для routing і timeout, `2184724a` для поля `model`, `abaeaa08` для міграції на глобальні тири та `pi`.

## Update 2026-06-06

Transcript додатково зафіксував, що залежність `@anthropic-ai/sdk` не видаляється з `package.json`, бо `npm/scripts/coverage-classify/index.mjs` на той момент ще використовував Anthropic SDK напряму. Для docgen reference implementation `piOneShot` взято з `npm/skills/fix/js/llm-worker.mjs`.

## Update 2026-06-06

Transcript уточнив стару routing-схему: `sym < 2` ішов у Tier 1 без cloud-рефері, `sym ∈ [2, 4)` ішов у Tier 1 із `cloudScoreDoc` через Haiku, `sym ≥ 4` ішов одразу в Tier 2. Після спрощення схема стала: `sym < 4` → Tier 1 local + det-scorer із порогом 70 + timeout → Tier 2 при fail; `sym ≥ 4` → Tier 2 одразу.

## Update 2026-06-06

- Уточнено, що після видалення Haiku-рефері gate для локального docgen складається з детермінованого `scoreDoc()` і timeout `LOCAL_TIMEOUT_MS = 5 * 60 * 1000` через `Promise.race`.
- При `scoreDoc() < 70` або `local-timeout` генерація ескалюється на Tier 2.
- `generateDoc` повертає поле `model` у всіх return-гілках, щоб batch-скрипт міг показувати фактичну модель для кожного файлу та окремо рахувати Tier1→Tier2 ескалації.
- Batch stats включають `{ ok, err, localOk, cloudOk, escalated }`; рядок ескалації виводиться лише коли `escalated > 0`.
- Transcript також фіксує міграцію LLM-викликів у `docgen`, `coverage-classify`, `coverage-fix` і `subagent-runner` з Anthropic SDK на `pi` transport з глобальними тирами моделей. Це доповнює ADR про глобальну класифікацію моделей, але не змінює рішення про видалення Haiku-рефері в docgen.
- Змінені файли з transcript: `npm/skills/docgen/js/docgen-gen.mjs`, `npm/scripts/coverage-classify/index.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/package.json`.
- Видалені залежності з transcript: `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`.
- Зафіксований негативний наслідок: `spawnSync('pi', ...)` є синхронним, тому не дає реального паралелізму в контекстах, які очікують async-виконання.
