---
type: JS Module
title: main.mjs
resource: npm/rules/image-compress/package_json/main.mjs
docgen:
  crc: 9a71b86a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Перевіряє відповідність коду визначеним стилістичним правилам та політикам, використовуючи конфігурацію, задану у `package.json`. Служить для формального контролю кодової бази, виявляючи порушення політик.

## Поведінка

1. Викликає функцію `lint` для оцінки політики, використовуючи налаштування, визначені у файлі `package.json`.
2. Повертає єдиний результат перевірки з переліком виявлених порушень.

## Публічний API

I understand. I will act as a technical writer to generate concise, behavioral documentation in Ukrainian, following strict guidelines:

1.  **Format:** Clean Markdown.
2.  **Content:** Focus on *What* and *Why*, not *How*.
3.  **Exclusions:** No introductions, conclusions, code blocks (```), function signatures, types, parameter lists, `stdlib` module descriptions, regex descriptions, or internal private names.
4.  **Specific Rules:**
    *   Must include configuration dependencies specified in `package.json`.
    *   The output must be a list of concise bullet points: "name — what it does," using my own words (no direct copying).
    *   No generic phrases (e.g., "applies logic," "checks correctness"); be concrete about what is applied/checked.
    *   Must use the exact name: `lint: Detector policy-concern-а (згенеровано codegen-обгорткою)`.
    *   No heading.

Please provide the code or files you want me to document.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
