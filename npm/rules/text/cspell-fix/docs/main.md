---
type: JS Module
title: main.mjs
resource: npm/rules/text/cspell-fix/main.mjs
docgen:
  crc: 63e4b48b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Реалізує інтеграцію `cspell` у текстовий лінт за новою схемою класифікації (`docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`): замість переписування файлів модуль детектить невідомі слова, класифікує їх LLM-ом і дописує валідні терміни у словник `.cspell.json`, лишаючи ймовірні одруки на ручний перегляд.

## Поведінка

`detectCspell` запускає `cspell` над переданими файлами (або всім репо) і повертає код виходу разом із виводом. Якщо cspell перевірив **нуль файлів** (усі цілі підпадають під `ignorePaths` з `.cspell.json`, напр. `docs/specs/**`) — це трактується як чисто (`code: 0`), а не як порушення: інакше файли поза скоупом cspell хибно блокували б PostToolUse hook.

`unknownWords` видобуває унікальні невідомі слова з виводу `cspell`. `runCspellText` виконує детект; у read-only/без LLM-режимі повертає код детекту як є. У LLM fix-режимі класифікує знахідки одним bounded-запитом (`classifyPrompt`/`parseClassify`), валідні слова дописує в словник через `appendWordsToDict`, ймовірні одруки друкує списком без автозаміни, після чого повторно детектить (`re-detect`) для фінального коду виходу.

## Публічний API

- `detectCspell` — запускає `cspell` над файлами/репо, нормалізує «нуль файлів перевірено» в успіх.
- `unknownWords` — унікальні невідомі слова з виводу `cspell`.
- `appendWordsToDict` — дописує нові слова до `.cspell.json#words` (sorted/dedup), повертає кількість доданих.
- `classifyPrompt` / `parseClassify` — формує LLM-промпт класифікації і парсить bounded JSON-відповідь.
- `runCspellText` — оркеструє детект → (опційно) класифікацію → словник → re-detect.
- `lint` — read-only detector для delta/full lint-прогону.

## Гарантії поведінки

- Fix-режим ніколи не переписує файли з текстом — лише словник `.cspell.json`.
- Помилки LLM-класифікації (мережа, парсинг) не зупиняють detect: falls back на сирий вивід `cspell`.
- Файли поза скоупом `cspell` (ignorePaths) ніколи не трактуються як порушення.
