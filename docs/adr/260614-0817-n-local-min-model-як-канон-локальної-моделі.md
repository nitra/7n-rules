---
type: ADR
title: N_LOCAL_MIN_MODEL як канон локальної моделі
description: Локальна omlx-модель для docgen і скілів задається через універсальний tier-env `N_LOCAL_MIN_MODEL`, а не через docgen-специфічний параметр.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

`fix-doc-files` викликає локальний omlx-сервер. Пакетний дефолт моделі не збігався з іменем, яке віддає omlx-сервер, тому генерація падала з `Model not found`. Потрібно було вибрати універсальну конфігурацію моделі, придатну не лише для docgen.

## Considered Options

* Використати `N_CURSOR_DOCGEN_MODEL` як docgen-специфічний env.
* Додати self-heal у пакеті для зрізання org-prefix у model id.
* Використати `N_LOCAL_MIN_MODEL` як універсальний tier-env для `resolveModel('min')`.

## Decision Outcome

Chosen option: "N_LOCAL_MIN_MODEL", because `fix-doc-files` читає `N_CURSOR_DOCGEN_MODEL ?? resolveModel('min')`, а `resolveModel('min')` уже використовує `N_LOCAL_MIN_MODEL`; це дає одну точку конфігурації для всіх скілів, які працюють на min-tier.

### Consequences

* Good, because `fix-doc-files` може запускатися без env-префікса в команді й підхоплює модель з `~/.zshenv`.
* Good, because інші скіли на tier `min` автоматично отримують ту саму локальну модель.
* Bad, because пакетний дефолт моделі лишається несумісним із локальним omlx без env або окремого self-heal.

## More Information

Файл моделі: `npm/lib/models.mjs`, функція `resolveModel`. Env: `N_LOCAL_MIN_MODEL=omlx/gemma-4-e2b-it-4bit`. Transcript фіксує, що `gemma-4-e4b-it-OptiQ-4bit` не вміщується на 16GB Mac, а `gemma-4-e2b-it-4bit` проходить локальний запуск.
