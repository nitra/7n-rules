---
type: ADR
title: Диференційовані таймаути fix-escalation
description: Fix-escalation cascade використовує коротший timeout для local рунгів і обриває хмарну драбину після transport timeout.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

У lint-fix escalation cascade всі рунги `local-min`, `local-min-retry`, `cloud-min` і `cloud-avg` використовували однаковий хардкодований timeout 120 секунд у `callModel`. Локальна 4b-модель впиралась у цю стіну (`curl 28: Operation timed out after 120006ms`) на важких правилах, а cloud-рунги після transport-збою `pi ETIMEDOUT` ескалували далі й витрачали `cloud-avg` budget без шансу на успіх.

## Considered Options

- Per-tier timeout: local рунги — `N_LOCAL_FIX_TIMEOUT_MS` з дефолтом 45 секунд, cloud рунги — `N_CLOUD_FIX_TIMEOUT_MS` з дефолтом 120 секунд.
- Однаковий 120 секунд timeout для всіх рунгів.
- Cloud transport timeout обриває cascade замість ескалації на `cloud-avg`.

## Decision Outcome

Chosen option: "Per-tier timeout і break після cloud transport timeout", because transcript фіксує, що local 4b-модель систематично витрачала 120 секунд на важкі правила, а `cloud-avg` не усуває transport timeout після `cloud-min`, лише витрачає обмежений avg budget.

### Consequences

- Good, because local рунги fail-fast приблизно за 45 секунд замість 120 секунд і швидше передають управління cloud tier.
- Good, because cloud transport timeout `ETIMEDOUT` або `pi error` обриває драбину й не витрачає `cloud-avg` budget.
- Bad, because якщо cloud timeout був transient мережевим збоєм, break може пропустити потенційно успішний `cloud-avg`; transcript не містить підтвердження такого випадку.
- Neutral, because transcript показує прогін без conformance-порушень, де cascade не запускався, тому реальна перевірка нового шляху потребує дельти з порушенням.

## More Information

- `npm/scripts/lib/fix/orchestrator.mjs` — `buildLadder` додає per-tier `timeoutMs`; `decideAfterFailure` використовує `CLOUD_TRANSPORT_RE` для `ETIMEDOUT|timed out|pi error` на non-local рунгу.
- `npm/scripts/lib/fix/llm-worker.mjs` — `callModel` і `runLlmWorker` приймають і прокидають `opts.timeoutMs` у `callLlm`.
- Env-змінні: `N_LOCAL_FIX_TIMEOUT_MS` дефолт `45000`, `N_CLOUD_FIX_TIMEOUT_MS` дефолт `120000`.
- `npm/scripts/lib/fix/tests/orchestrator.test.mjs` — тести per-tier timeout, прокидання timeout у worker і cloud transport break.
- Escalation-лог `.n-cursor/fix-escalation.jsonl` у transcript підтвердив проблему: `cloud-avg` викликався після `cloud-min ETIMEDOUT`.
- Change-файл: `npm/.changes/260619-1716.md`.

## Update 2026-06-19

- Додатково зафіксовано, що локальний JSON parse fail 4b-моделі не потребує lenient-repair парсера: transcript показує, що `js-run` закрився на `cloud-min`, тобто драбина ескалації вже обробляє цей клас помилок без ускладнення `llm-fix-apply.mjs`.
- Для file-less правил у цьому драфті обговорювався generic repo-context fallback; фінальне рішення винесене в окремий ADR `repo-context-для-file-less-правил-fix-escalation.md`.
