---
type: JS Module
title: claims.mjs
resource: npm/rules/ci4/package_knowledge/claims.mjs
docgen:
  crc: 305f2156
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Будує evidence-backed implemented claims із semantic chunks через batch map/reduce.

LLM лише добирає structured твердження для відомих deterministic references.
Canonical claim IDs, cache keys, coverage і final ordering належать цьому core,
тому неповний або невалідний result ніколи не стає candidate graph.

## Публічний API

- CLAIM_SCHEMA_VERSION — Версія schema для structured claims cache і validation.
- CLAIM_PROMPT_VERSION — Версія prompt contract для structured claims batch pipeline.
- DEFAULT_MODEL_POLICY — Default model policy tiers для map/reduce escalation.
- createImplementedClaimId — Створює canonical claim identity. LLM ніколи не передає цей ID у contract.
- createClaimsCacheKey — Створює cache key, що залежить від parser/prompt/schema/model policy/content.
- parseClaimsResult — Parses and validates one strict LLM result against deterministic references.
- buildStructuredClaims — Executes structured LLM claims map/reduce without candidate publication.

Each wave has one `submitBatch` call per universal tier and retries only the
failed items on a stronger tier. A missing, invalid, or uncovered result is a
blocking diagnostic; no whole-domain retry or fallback claim is produced.

Planner adapter для кожного map chunk мусить передати тільки його local
`allowedEvidenceIds`, а також `wave` і `dependsOnChunkIds`; dependencies
мають посилатися лише на вже завершені попередні waves.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/claims.test.mjs` (buildStructuredClaims) — executes map waves in dependency order and injects canonical dependency summaries; uses successful map and reduce cache entries without any LLM call; escalates only failed chunk to next universal tier; fails closed after invalid JSON instead of accepting unverified claims; blocks missing result and uncovered required edge; ще 3

## Гарантії поведінки

- Кешує результати в межах одного прогону.
