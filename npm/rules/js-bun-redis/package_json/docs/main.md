---
type: JS Module
title: main.mjs
resource: npm/rules/js-bun-redis/package_json/main.mjs
docgen:
  crc: b43c4c78
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Аналізує файли `package.json` у всіх підкаталогах проекту. Виконує публічну функцію `lint`, перевіряючи конфігурації залежностей на відповідність політиці проекту. Конфігурації, які використовуються в цьому аналізі, визначаються у файлі package.json. Результатом роботи є виявлення всіх порушень.

## Поведінка

1. Аналізує файли `package.json` у всіх підкаталогах проекту.
2. Перевіряє ці файли на відповідність встановленим політичним вимогам.
3. Повертає уніфікований результат перевірки, який містить список порушень.

## Публічний API

I understand. As a technical writer, I will generate concise behavioral documentation in Ukrainian using clean Markdown, adhering to strict constraints:

1.  **Focus:** Describe *what* the code does and *why*, not *how* (no implementation details).
2.  **Format:** Pure Markdown, no surrounding ``` block.
3.  **Exclusions:** No introductions, no conclusions, no function signatures, types, or parameters. No lists of `stdlib` modules, regex descriptions, or private internal names.
4.  **Required Anchors:** Must include `package.json`.
5.  **Style:** Concise bullet points: "name — what it does," in my own words, without types or signatures.
6.  **Specific Naming:** Must use the exact names provided.
7.  **Tone:** No generic phrasing (e.g., "applies logic," "checks correctness")—be specific about *what* is being applied/checked.
8.  **Header/Footer:** No titles or concluding statements.

Please provide the code you want me to document.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
