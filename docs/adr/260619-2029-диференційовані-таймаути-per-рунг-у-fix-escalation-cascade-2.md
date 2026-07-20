---
type: ADR
title: Диференційовані таймаути per-рунг у fix-escalation cascade
description: Fix-escalation cascade використовує окремі timeout-и для local і cloud рунгів та обриває cloud cascade після транспортного timeout.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

У lint-fix escalation cascade всі рунги — `local-min`, retry, `cloud-min`, `cloud-avg` — використовували однаковий хардкодований timeout 120 секунд у `callModel`. Локальна 4b-модель впиралась у timeout на важких правилах, а після cloud transport failure cascade міг ескалювати до `cloud-avg` і витрачати обмежений avg-бюджет без шансу на успіх.

## Considered Options

- Per-tier timeout: локальні рунги беруть `N_LOCAL_FIX_TIMEOUT_MS` з дефолтом 45 секунд, хмарні — `N_CLOUD_FIX_TIMEOUT_MS` з дефолтом 120 секунд; cloud transport timeout обриває решту cloud-рунгів.
- Однаковий 120-секундний timeout для всіх рунгів.

## Decision Outcome

Chosen option: "Per-tier timeout і break після cloud transport timeout", because transcript фіксує, що локальна 4b-модель систематично витрачала 120 секунд на важкі правила, а `pi ETIMEDOUT` є транспортною стіною, яку `cloud-avg` не виправляє якістю моделі.

### Consequences

- Good, because local-рунги fail-fast за приблизно 45 секунд замість 120 і швидше передають керування cloud-тиру.
- Good, because `cloud-avg` budget більше не витрачається після `ETIMEDOUT`, `timed out` або `pi error` на cloud-min.
- Bad, because якщо cloud timeout є transient-мережевою помилкою, break може пропустити потенційно успішну наступну cloud-спробу; transcript не містить підтвердження частоти такого false-break.
- Neutral, because якщо в delta немає conformance violations, cascade не запускається і escalation-log не оновлюється.

## More Information

- `npm/scripts/lib/fix/orchestrator.mjs` — `buildLadder` додає per-tier `timeoutMs`; `decideAfterFailure` використовує `CLOUD_TRANSPORT_RE`; `escalateRule` прокидає timeout у worker.
- `npm/scripts/lib/fix/llm-worker.mjs` — `callModel` і `runLlmWorker` приймають `opts.timeoutMs` і передають його в `callLlm`.
- Env-змінні: `N_LOCAL_FIX_TIMEOUT_MS` дефолт `45000`, `N_CLOUD_FIX_TIMEOUT_MS` дефолт `120000`.
- Тести: `npm/scripts/lib/fix/tests/orchestrator.test.mjs` — кейси per-tier timeout, передача timeout у worker і cloud-transport break з `avgUsed: 0`.
- Escalation-log `.n-cursor/fix-escalation.jsonl` підтвердив проблему: `cloud-avg` викликався після `cloud-min ETIMEDOUT`.
- Change-файл: `npm/.changes/260619-1716.md`.

## Update 2026-06-19

- Transcript додатково фіксує, що local JSON parse failure 4b-моделі для `js-run` не потребує lenient-repair парсера: cloud-min успішно закрив правило, тобто наявна драбина ескалації вирішує цей дефект без ускладнення `llm-fix-apply.mjs`.
- Розглянутий варіант lenient JSON repair відхилено як overengineering для специфічного дефекту локальної 4b-моделі.
