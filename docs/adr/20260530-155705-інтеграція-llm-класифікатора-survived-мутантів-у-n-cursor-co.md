---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-30T15:57:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

## ADR Інтеграція LLM-класифікатора survived мутантів у `n-cursor coverage`

## Context and Problem Statement

Поточний `n-cursor coverage` намагається наблизитись до 100% mutation score, що змушує писати тести для CLI-обгорток, spawn-wrappers і defensive-гілок, де unit-тести не дають сигналу. Потрібен механізм, який відрізняє «killable» мутантів від «allowed gaps» (equivalent, glue, wrapper тощо) і виключає дозволені gap-и зі знаменника mutation score.

## Considered Options

* LLM-класифікатор (Claude Sonnet 4.6) для кожного survived мутанта з git-blob-hash-keyed cache
* Статичні exclusions з мотивацією у `coverage-policy.yaml` + `@test-policy` JSDoc-маркери (без LLM)

## Decision Outcome

Chosen option: "LLM-класифікатор (Claude Sonnet 4.6) з file-hash-keyed cache", because user обрав Рівень 3 (автономна LLM-класифікація) після обговорення трьох рівнів; статичні exclusions запропоновані як Рівні 1–2 з найвищим ROI, але вирішено відразу будувати повноцінне рішення.

### Consequences

* Good, because transcript фіксує очікувану користь: `Killable score` рахується лише на мутантах, яких LLM не класифікував як equivalent/defensive/glue/wrapper з confidence ≥ 0.7, що усуває шум від 100%-метричного бенчмарку.
* Bad, because transcript не містить підтверджених негативних наслідків; final review зафіксував follow-up: `runCoverageSteps` передає в `fixSurvivedMutants` повний `allSurvived` замість відфільтрованого — fix-агент може дописувати тести для allowed-gaps; нешкідливо при threshold=1.1 (MVP rollout), але вимагає виправлення до зниження threshold до 0.7.

## More Information

**Файли створені:**
- `npm/scripts/coverage-classify/index.mjs` — orchestrator: cache lookup → Claude API → cache write → conservative fallback
- `npm/scripts/coverage-classify/verdict-schema.mjs` — Zod-схема з 5 verdicts (`worth-testing`, `equivalent`, `defensive`, `glue`, `wrapper`), `confidence` 0–1, `reason` 20–500 chars, `parseVerdict`
- `npm/scripts/coverage-classify/cache.mjs` — `deriveBlobHash` (`git hash-object` + sha1 fallback), `deriveCacheKey`, `readCache`/`writeCache` з schema versioning; cache key = `<git-blob-hash>:<line>:<col>:<base64url(replacement)>`
- `npm/scripts/coverage-classify/prompt.mjs` — `SYSTEM_PROMPT` (cached, ephemeral) + `buildUserPrompt` (mutant location, source ±10 рядків, existing tests, git activity)
- `npm/scripts/coverage-classify/apply.mjs` — `isAllowedGap` + `applyVerdicts`: skip rule — `verdict in {equivalent,defensive,glue,wrapper} AND confidence ≥ threshold`

**Cache:** `npm/reports/coverage-classify.cache.json` у `.gitignore` (per-machine); schema `version: 1`.

**MVP threshold:** `1.1` (no gap allowed) для збору реальних даних; знижується до `0.7` після валідації на одному прогоні.

**Graceful skip:** якщо `ANTHROPIC_API_KEY` не встановлено або `@anthropic-ai/sdk` недоступний — `console.warn`, classification skipped, COVERAGE.md показує Raw score без зміни.

**API:** `claude-sonnet-4-6`, `max_tokens: 1024`, system prompt з `cache_control: {type: "ephemeral"}`.

**Spec:** `docs/superpowers/specs/2026-05-30-coverage-classify-design.md`; plan: `docs/superpowers/plans/2026-05-30-coverage-classify.md`.

**Commits:** `ce7f206` (verdict-schema), `b7a7a9c` (cache), `c06a105` (prompt), `fd5ff34` (apply), `20fafef` (index), `51c8bc3` (coverage integration), `b0947da` (change-file); merge fast-forward до `main` на `99b5a8e`.
