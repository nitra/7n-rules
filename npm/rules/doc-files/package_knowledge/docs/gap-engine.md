---
type: JS Module
title: gap-engine.mjs
resource: npm/rules/doc-files/package_knowledge/gap-engine.mjs
docgen:
  crc: d2607565
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Порівнює evidence-backed expected та implemented claims без LLM.

Engine приймає лише explicit structured mappings: він не виводить semantic
відповідність із prose, а низьку confidence чи суперечливі mappings чесно
залишає у статусі unresolved.

## Поведінка

evaluateGaps повертає `ok: false` з діагностиками, коли блокують валідаційні умови публікації або коли вхідні мапінги не проходять перевірку на узгодженість із відомими evidence та очікуваними claims. У таких випадках статус gap не формується.

`ok: true` означає, що всі надані structured mappings зведені до впорядкованого списку gaps без LLM-інтерпретації prose. Низька confidence, неузгодженість або відсутність достатнього evidence лишають claim у невизначеному стані замість примусового hard status.

Результат є детермінованим для того самого graph, mappings, unresolvedExpectedClaimIds та minimumConfidence. Файл не має власного запису стану й не виконує побічних змін.

## Публічний API

- evaluateGaps — Evaluates deterministic gap statuses from explicit structured mappings.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/gap-engine.test.mjs` (evaluateGaps) — returns no gap when graph has no explicit expectation; marks an exact evidence-backed equivalent mapping as satisfied; marks an evidence-backed expectation without mapping as missing; marks an exact contradictory mapping as diverged; keeps low-confidence implementation and ambiguous mappings unresolved; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
