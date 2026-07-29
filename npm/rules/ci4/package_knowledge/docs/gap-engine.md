---
type: JS Module
title: gap-engine.mjs
resource: npm/rules/ci4/package_knowledge/gap-engine.mjs
docgen:
  crc: 9dd13178
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Порівнює evidence-backed expected та implemented claims без LLM.

Engine приймає лише explicit structured mappings: він не виводить semantic
відповідність із prose, а низьку confidence чи суперечливі mappings чесно
залишає у статусі unresolved.

## Поведінка

evaluateGaps повертає об'єкт, що містить результат перевірки або список діагностичних повідомлень у випадку невдачі. Успішний результат містить масив об'єктів, що описують виявлені розриви.

## Публічний API

- evaluateGaps — Evaluates deterministic gap statuses from explicit structured mappings.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/gap-engine.test.mjs` (evaluateGaps) — returns no gap when graph has no explicit expectation; marks an exact evidence-backed equivalent mapping as satisfied; marks an evidence-backed expectation without mapping as missing; marks an exact contradictory mapping as diverged; keeps low-confidence implementation and ambiguous mappings unresolved; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
