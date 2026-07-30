---
type: JS Module
title: assess-need.mjs
resource: plugins/lang-js/coverage-provider/fix/assess-need.mjs
docgen:
  crc: ad8c8cb8
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

LLM-довизначення потреби в тестах для непокритого файлу (fix-шлях концерну
`coverage` правила `test`, команда \`npx \@7n/rules lint test\`).

Швидка локальна евристика (`quickClassify`, спільна з делта-гейтом) відсіює
очевидні випадки — LLM викликається лише для неоднозначних файлів, ОДНИМ
`submitBatch`-викликом на всі неоднозначні файли разом (уніфікація на
`@7n/llm-lib/batch`, спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`,
кластер E) замість конкурентного `Promise.all` окремих one-shot-викликів.

## Публічний API

- assessNeed — Оцінює список непокритих файлів: чи потрібні їм тести.
Очевидні випадки (реекспорти, функції з розгалуженнями) вирішуються локально;
неоднозначні йдуть ОДНОЮ batch-хвилею на tier1, ті, чию відповідь не вдалось
розпарсити, — другою хвилею на tier2, решта — conservative fallback.
Типові tier1/tier2 моделі визначає universal policy resolver від
`N_LOCAL_MIN_MODEL` та `N_CLOUD_MIN_MODEL`, тому відсутній selector переходить
до наступної доступної моделі за policy ladder.

## Сценарії використання

- `plugins/lang-js/coverage-provider/tests/assess-need.test.mjs` (quickClassify; assessNeed) — returns false for pure re-export file; returns false for import-only file; returns true for file with branches and function bodies; returns true for arrow functions with branches; returns null for ambiguous file (function without branches); ще 15

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
