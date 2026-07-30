---
type: JS Module
title: claims.mjs
resource: npm/rules/doc-files/package_knowledge/claims.mjs
docgen:
  crc: 61d41d78
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Будує evidence-backed implemented claims із semantic chunks через batch map/reduce.

LLM лише добирає structured твердження для відомих deterministic references.
Canonical claim IDs, cache keys, coverage і final ordering належать цьому core,
тому неповний або невалідний result ніколи не стає candidate graph.
Кожна required semantic unit мусить мати evidence-backed claim зі stable
business/architecture taxonomy; довільні predicates та coverage bypass блокуються.

## Публічний API

- CLAIM_SCHEMA_VERSION — Версія schema для structured claims cache і validation.
- CLAIM_PROMPT_VERSION — Версія prompt contract для structured claims batch pipeline.
- DEFAULT_MODEL_POLICY — Default model policy tiers для map/reduce escalation.
- BEHAVIORAL_CLAIM_TAXONOMY — Stable evidence-backed categories permitted in behavioral claim prompts.
- createImplementedClaimId — Створює canonical claim identity. LLM ніколи не передає цей ID у contract.
- createClaimsCacheKey — Створює cache key, що залежить від parser/prompt/schema/model policy/content.
- parseClaimsResult — Parses and validates one strict LLM result against deterministic references.
- buildStructuredClaims — Executes structured LLM claims map/reduce without candidate publication.

Each wave has one `submitBatch` call per universal tier and retries only the
failed items on a stronger tier. A missing, invalid, or uncovered result is a
blocking diagnostic; no whole-domain retry or fallback claim is produced.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/claims.test.mjs` (buildStructuredClaims) — executes map waves in dependency order and injects canonical dependency summaries; uses successful map and reduce cache entries without any LLM call; escalates only failed chunk to next universal tier; fails closed after invalid JSON instead of accepting unverified claims; requires a behavioral claim for every required semantic unit and states the stable taxonomy in the prompt; ще 5

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
