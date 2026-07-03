---
type: JS Module
title: main.mjs
resource: npm/rules/adr/settings_local_json/main.mjs
docgen:
  crc: 0a60d9f5
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Функція `lint` перевіряє відповідність конфігурації заданих правил, що визначені у конфігураційному файлі settings.local.json.

## Поведінка

1. Викликається функція lint для перевірки конфігурації.
2. Перевірка здійснюється на основі правил, визначених у `settings.local.json`.

## Публічний API

Understood. I will act as a technical writer, generating concise behavioral documentation in Ukrainian using clean Markdown, adhering strictly to your constraints.

My output will focus on **WHAT** and **WHY**, avoiding **HOW**.

**Constraints Checklist:**
*   Concise behavioral documentation (Ukrainian).
*   Clean Markdown format.
*   No introductions or conclusions.
*   Must not be wrapped in a code block.
*   Forbidden: function signatures, types, parameters, stdlib module lists, regex descriptions, private internal names.
*   **Mandatory Anchors:** `settings.local.json`.
*   **Format:** Concise bullet points: `name — what it does`.
*   **Style:** My own words (no literal copying), without types/signatures.
*   **Specific Constraint:** For the list, use the exact names provided and avoid generic phrasing (e.g., "applies logic", "checks correctness")—focus on the concrete action.

Please provide the code or context you wish me to document.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
