---
type: JS Module
title: gap-engine.mjs
resource: npm/rules/ci4/package_knowledge/gap-engine.mjs
docgen:
  crc: 3fe10125
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Порівнює evidence-backed expected та implemented claims без LLM.

Engine приймає лише explicit structured mappings: він не виводить semantic
відповідність із prose, а низьку confidence чи суперечливі mappings чесно
залишає у статусі unresolved.

## Поведінка

Функція evaluateGaps повертає множину нерозв'язаних розбіжностей або виявлені блокери публікації, залежно від наданих даних.
При відсутності достатньої впевненості в підтвердженні, функція не визначає жорсткого статусу для декларацій.
Функція не забезпечує внутрішніх механізмів для збереження стану або кешування результатів перевірок.

## Публічний API

- evaluateGaps — Evaluates deterministic gap statuses from explicit structured mappings.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/gap-engine.test.mjs` (evaluateGaps) — returns no gap when graph has no explicit expectation; marks an exact evidence-backed equivalent mapping as satisfied; marks an evidence-backed expectation without mapping as missing; marks an exact contradictory mapping as diverged; keeps low-confidence implementation and ambiguous mappings unresolved; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
