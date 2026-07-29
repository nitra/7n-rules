---
type: JS Module
title: gap-engine.mjs
resource: npm/rules/ci4/package_knowledge/gap-engine.mjs
docgen:
  crc: 6612d972
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

evaluateGaps повертає або відсортований список gap-станів, або blocking diagnostics, якщо вхідна валідація чи зіставлення не проходять перевірку. Це робить результат придатним для публікації лише тоді, коли всі явні умови узгоджені.

Функція працює лише з explicit structured mappings: якщо відповідність не підтверджена evidence-backed фактами або confidence нижча за політику, такий запис лишається unresolved замість того, щоб бути примусово інтерпретованим як gap. Суперечливі mapping-дані також не перетворюються на вигаданий висновок.

Якщо validation для parser або coverage не є прийнятною, повертаються diagnostics із stable code та message, а не список gaps.

## Публічний API

- evaluateGaps — Evaluates deterministic gap statuses from explicit structured mappings.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/gap-engine.test.mjs` (evaluateGaps) — returns no gap when graph has no explicit expectation; marks an exact evidence-backed equivalent mapping as satisfied; marks an evidence-backed expectation without mapping as missing; marks an exact contradictory mapping as diverged; keeps low-confidence implementation and ambiguous mappings unresolved; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
