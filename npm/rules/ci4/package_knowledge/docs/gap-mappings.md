---
type: JS Module
title: gap-mappings.mjs
resource: npm/rules/ci4/package_knowledge/gap-mappings.mjs
docgen:
  crc: 6f1c9c2d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Виводить evidence-backed mappings між expected та implemented claims.
Точні canonical matches обходять LLM, а non-exact same-subject кандидати
проходять strict semantic comparator, щоб невизначеність не ставала missing.

## Публічний API

- GAP_MAPPING_SCHEMA_VERSION — Версія strict claim-comparison result schema.
- GAP_MAPPING_PROMPT_VERSION — Версія prompt contract для expected-to-implemented comparator.
- DEFAULT_GAP_MAPPING_MODEL_POLICY — Єдина universal model ladder semantic comparator-а.
- createGapMappingCacheKey — Створює cache key semantic comparison per expected claim і candidate set.
- parseGapMappingResult — Парсить strict comparator JSON і не допускає чужі IDs або неоднозначні relations.
- compareClaimMappings — Порівнює expected claims із AS-IS claims до gap engine.

Runner integration hook: викликати після entailment verification, перед
`evaluateGaps`, і передати `mappings` та `unresolvedExpectedClaimIds` у gate.
Точні canonical matches не викликають модель; відсутність same-subject
candidate детерміновано лишає expectation missing.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/gap-mappings.test.mjs` (compareClaimMappings) — derives an exact equivalent mapping with zero LLM calls; leaves an expectation missing only when no same-subject implementation exists; maps a semantic contradiction to diverged with combined evidence IDs; keeps ambiguous same-subject comparison unresolved instead of missing; escalates malformed results and reuses the unchanged successful cache

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
