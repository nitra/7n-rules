---
type: JS Module
title: gap-engine.mjs
resource: npm/rules/ci4/package_knowledge/gap-engine.mjs
docgen:
  crc: fc1f0a20
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

Система не гарантує виявлення суперечностей або розбіжностей, якщо вони не представлені у вигляді явного структурованого зіставлення.
При використанні функції `evaluateGaps`, невідповідності, що виникають через недостатню впевненість або внутрішні суперечності в наданих зіставленнях, залишаються у стані незавершеного вирішення.
Функція `evaluateGaps` не містить внутрішніх механізмів для самостійного виведення семантичної відповідності для прозових описів.

## Публічний API

- evaluateGaps — Evaluates deterministic gap statuses from explicit structured mappings.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/gap-engine.test.mjs` (evaluateGaps) — returns no gap when graph has no explicit expectation; marks an exact evidence-backed equivalent mapping as satisfied; marks an evidence-backed expectation without mapping as missing; marks an exact contradictory mapping as diverged; keeps low-confidence implementation and ambiguous mappings unresolved; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
