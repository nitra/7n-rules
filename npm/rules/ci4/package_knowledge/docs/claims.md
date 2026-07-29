---
type: JS Module
title: claims.mjs
resource: npm/rules/ci4/package_knowledge/claims.mjs
docgen:
  crc: ecaec6e9
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`CLAIM_SCHEMA_VERSION`, `CLAIM_PROMPT_VERSION` і `DEFAULT_MODEL_POLICY` задають узгодженість побудови evidence-backed claims у межах одного прогону. `createImplementedClaimId` і `createClaimsCacheKey` фіксують canonical claim IDs та cache keys, а `parseClaimsResult` і `buildStructuredClaims` відбирають лише валідні structured claims для відомих deterministic references. Неповний або невалідний result не потрапляє до candidate graph, тож coverage і фінальне впорядкування лишаються під контролем core.

## Поведінка

CLAIM_SCHEMA_VERSION задає стабільну версію схеми структурованих claims для цього конвеєра; CLAIM_PROMPT_VERSION фіксує сумісний формат prompt envelope, щоб кеш і валідація лишалися синхронними між прогоном і повторним використанням результатів.

DEFAULT_MODEL_POLICY задає базовий порядок tier-ів для batch-обробки: система спершу працює в межах дозволених рівнів, а далі піднімає тільки проблемні work items, не запускаючи повний повтор домену.

buildStructuredClaims приймає graph і chunks, знімає snapshot кешу, перевіряє graph references і далі веде map/reduce хвилі через resolveWave та createReduceWork. Кожна хвиля збирає лише відомі deterministic references, відкидає неваліді або непокриті відповіді як blockers і зберігає лише успішні structured results у cache. Після завершення results проходять collectClaims для дедуплікації та стабільного порядку, а coverage повертає тільки фактично підтверджені nodeIds та edgeIds.

createClaimsCacheKey замикає cache на parserVersion, promptVersion, schemaVersion, modelPolicy і contentHash, щоб один і той самий структурний контекст давав той самий ключ і не змішував різні режими аналізу.

createImplementedClaimId формує детермінований identity для вже підтвердженого claim на основі відомих полів graph, а не згенерованого кандидата; цей ID використовується як стабільна опора для дедуплікації та подальшого сортування.

parseClaimsResult приймає лише strict JSON, звіряє його з відомими refs і covered work unit, відсікає зайві або неповні твердження та повертає або валідований structured result, або fail-closed reason. Саме ця перевірка не допускає, щоб результат без повного покриття чи з чужими references потрапив у candidate graph.

## Публічний API

- createImplementedClaimId — Створює canonical claim identity. LLM ніколи не передає цей ID у contract.
- createClaimsCacheKey — Створює cache key, що залежить від parser/prompt/schema/model policy/content.
- parseClaimsResult — Parses and validates one strict LLM result against deterministic references.
- buildStructuredClaims — Executes structured LLM claims map/reduce without candidate publication.

Each wave has one `submitBatch` call per universal tier and retries only the
failed items on a stronger tier. A missing, invalid, or uncovered result is a
blocking diagnostic; no whole-domain retry or fallback claim is produced.
- CLAIM_SCHEMA_VERSION — фіксує версію схеми для claims, щоб різні частини системи узгоджено читали й оновлювали один формат.
- CLAIM_PROMPT_VERSION — фіксує версію prompt-правил для генерації claims, щоб зміни в інструкціях були контрольованими.
- DEFAULT_MODEL_POLICY — задає стандартний вибір моделі для звичайного режиму, щоб система працювала передбачувано без ручного налаштування.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/claims.test.mjs` (buildStructuredClaims) — submits one map batch per wave and creates canonical IDs in deterministic core; uses successful map and reduce cache entries without any LLM call; escalates only failed chunk to next universal tier; fails closed after invalid JSON instead of accepting unverified claims; blocks missing result and uncovered required edge; ще 1

## Гарантії поведінки

- Кешує результати в межах одного прогону.
