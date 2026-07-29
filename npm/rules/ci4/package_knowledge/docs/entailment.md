---
type: JS Module
title: entailment.mjs
resource: npm/rules/ci4/package_knowledge/entailment.mjs
docgen:
  crc: 3989f332
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Верифікує, що implemented і expected claims справді випливають з локального
тексту їхнього evidence. Gate не синтезує і не переписує claims: він лише
пропускає канонічний graph далі або повертає blocking diagnostics.

## Поведінка

ENTAILMENT_SCHEMA_VERSION представляє версію схеми, що використовується у логіці верифікації. ENTAILMENT_PROMPT_VERSION визначає версію промпта, застосованого для моделі. DEFAULT_ENTAILMENT_MODEL_POLICY задає політику, що регулює використання моделі. createEntailmentCacheKey забезпечує стійкий ключ кешування, який базується на канонічному представленні об'єкта, відбитку даних доказу та версіях політики та схеми. parseEntailmentResult обробляє сирий відповідь моделі, приймаючи її як прийнятну або визначаючи причину відмови. verifyEvidenceEntailment виконує основну перевірку, порівнюючи стабільні об'єкти з локальними доказами, і повертає або затверджені висновки, або діагностичні блоки.

## Публічний API

- ENTAILMENT_SCHEMA_VERSION — Версія strict entailment response schema і cache entries.
- ENTAILMENT_PROMPT_VERSION — Версія prompt contract для evidence entailment verifier.
- DEFAULT_ENTAILMENT_MODEL_POLICY — Єдина допустима universal model ladder для semantic verification.
- createEntailmentCacheKey — Створює per-claim cache key з canonical claim, evidence text fingerprint і policy.
- parseEntailmentResult — Парсить єдиний strict verifier response без поблажливого coercion.
- verifyEvidenceEntailment — Верифікує immutable graph claims проти exact local evidence до gap/render.

Runner integration hook: викликати після claims плюс Expected overlay та до
gap/render; передати source slices за кожним evidence ID і продовжити лише
коли `ok: true`. Gate ніколи не повертає переписані claims.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/entailment.test.mjs` (verifyEvidenceEntailment) — passes supported implemented and expected claims without rewriting them; blocks unrelated or contradictory claims after the strict ladder; escalates malformed responses only for unresolved claims; uses unchanged successful per-claim cache without a model call; blocks any claim that lacks local evidence content before model submission; ще 2

## Гарантії поведінки

- Кешує результати в межах одного прогону.
