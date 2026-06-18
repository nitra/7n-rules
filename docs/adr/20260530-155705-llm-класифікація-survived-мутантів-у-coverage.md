---
type: ADR
title: "Інтеграція LLM-класифікатора survived мутантів у `n-cursor coverage`"
---

# Інтеграція LLM-класифікатора survived мутантів у `n-cursor coverage`

**Status:** Accepted
**Date:** 2026-05-30

## Context and Problem Statement

Поточний `n-cursor coverage` штовхав до 100% mutation score, змушуючи писати тести для CLI-обгорток, spawn-wrappers і defensive-гілок, де unit-тест не дає сигналу. Потрібен механізм, який відрізняє «killable» мутантів від «allowed gaps» (equivalent, glue, wrapper тощо) і виключає дозволені gaps зі знаменника mutation score.

## Considered Options

- LLM-класифікатор (Claude Sonnet 4.6) для кожного survived мутанта з git-blob-hash-keyed cache.
- Статичні exclusion-файли (`coverage-policy.yaml`) — ручне ведення без reasoning.

## Decision Outcome

Chosen option: "LLM-класифікатор (Claude Sonnet 4.6) з file-hash-keyed cache", because user обрав Рівень 3 (автономна LLM-класифікація) після обговорення трьох рівнів; статичні exclusions запропоновані як Рівні 1–2, але вирішено відразу будувати повноцінне рішення. Threshold=1.1 на старті (нуль активних виключень) для збору реальних даних перед зниженням до 0.7.

### Consequences

- Good, because `Killable score` рахується лише на мутантах, яких LLM не класифікував як equivalent/defensive/glue/wrapper з confidence ≥ 0.7 — метрика відображає реальну якість тестів, а не артефакти типу cli-glue.
- Good, because cache за git-blob-hash означає: повторна класифікація не викликає API, якщо файл не змінився.
- Bad, because без `ANTHROPIC_API_KEY` класифікація мовчки скіпається (`console.warn`), COVERAGE.md показує тільки Raw score без Killable Score.
- Bad, because `runCoverageSteps` передає в `fixSurvivedMutants` повний `allSurvived` замість відфільтрованого — coverage-fix-агент може дописувати тести для allowed-gaps; нешкідливо при threshold=1.1, але вимагає виправлення до зниження threshold до 0.7.

## More Information

Файли створені:
- `npm/scripts/coverage-classify/index.mjs` — orchestrator: cache lookup → Claude API → cache write → conservative fallback
- `npm/scripts/coverage-classify/verdict-schema.mjs` — Zod-схема: 5 verdicts (`worth-testing`, `equivalent`, `defensive`, `glue`, `wrapper`), `confidence` 0–1, `reason` 20–500 chars, `parseVerdict`
- `npm/scripts/coverage-classify/cache.mjs` — `deriveBlobHash` (git hash-object + sha1 fallback), `deriveCacheKey`, `readCache`/`writeCache`; cache key: `<git-blob-hash>:<line>:<col>:<base64url(replacement)>`
- `npm/scripts/coverage-classify/prompt.mjs` — `SYSTEM_PROMPT` (cached, ephemeral) + `buildUserPrompt` (mutant location, source ±10 рядків, existing tests, git activity)
- `npm/scripts/coverage-classify/apply.mjs` — `isAllowedGap` + `applyVerdicts`; skip rule: `verdict ∈ {equivalent, defensive, glue, wrapper} AND confidence ≥ threshold`

Cache: `npm/reports/coverage-classify.cache.json` (gitignored); schema `version: 1`.
API: `claude-sonnet-4-6`, `max_tokens: 1024`, system prompt з `cache_control: {type: "ephemeral"}`.
Spec: `docs/superpowers/specs/2026-05-30-coverage-classify-design.md`; plan: `docs/superpowers/plans/2026-05-30-coverage-classify.md`.
Commits: `ce7f206` (verdict-schema), `b7a7a9c` (cache), `c06a105` (prompt), `fd5ff34` (apply), `20fafef` (index), `51c8bc3` (coverage integration), `b0947da` (change-file); merge fast-forward до main: `99b5a8e`.

## Update 2026-05-30

Додаткова considered option (з ранньої сесії): JSDoc-мітки `@test-policy: glue` безпосередньо в source-файлах — локалізовані, але не містять reasoning і не підходять для uncovered-files; відхилено на користь LLM-підходу. Spec закомічено у `c1d0980`.

## Update 2026-05-30

Додаткова considered option (з пізнішої сесії): Piggybacking на Stryker incremental.json (класифікувати лише нові мутанти); відхилено на користь повного LLM-класифікатора. Залежності у `npm/package.json#dependencies`: `@anthropic-ai/sdk ^0.100.1`, `zod ^4.4.3`. Уточнений bad наслідок: без `ANTHROPIC_API_KEY` COVERAGE.md публікується без будь-якої позначки «classify: skipped» в документі — тільки `console.warn` у stdout; silent skip може бути непомітним для читача звіту.
