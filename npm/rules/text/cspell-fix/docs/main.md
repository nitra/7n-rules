---
type: JS Module
title: main.mjs
resource: npm/rules/text/cspell-fix/main.mjs
docgen:
  crc: 8dc85c3a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

## Огляд

Реалізує інтеграцію `cspell` у текстовий лінт за схемою класифікації (`docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`): замість переписування файлів невідомі слова класифікуються LLM-ом, валідні терміни дописуються у словник `.cspell.json`, ймовірні одруки лишаються на ручний перегляд. Цей модуль — read-only детект і shared-хелпери класифікації; сама LLM-класифікація виконується у `fix-worker.mjs` (Central Runner Pipeline).

## Поведінка

`detectCspell` запускає `cspell` над переданими файлами (або всім репо) і повертає код виходу разом із виводом. Якщо cspell перевірив **нуль файлів** (усі цілі підпадають під `ignorePaths` з `.cspell.json`, напр. `docs/specs/**`) — це трактується як чисто (`code: 0`), а не як порушення: інакше файли поза скоупом cspell хибно блокували б PostToolUse hook.

`unknownWords` видобуває унікальні невідомі слова з виводу `cspell`. `runCspellText` виконує read-only детект: чисто → `0`; інакше друкує вивід cspell і повертає його код. `lint` загортає це у `LintResult` (порожній delta-перелік файлів → одразу чисто).

## Публічний API

- `detectCspell` — запускає `cspell` над файлами/репо, нормалізує «нуль файлів перевірено» в успіх.
- `unknownWords` — унікальні невідомі слова з виводу `cspell`.
- `appendWordsToDict` — дописує нові слова до `.cspell.json#words` (sorted/dedup), повертає кількість доданих.
- `classifyPrompt` / `parseClassify` — формує LLM-промпт класифікації і парсить bounded JSON-відповідь (використовуються `fix-worker.mjs`).
- `runCspellText` — read-only детект: cspell по delta-файлах або всьому репо.
- `lint` — read-only detector для delta/full lint-прогону.

## Гарантії поведінки

- Модуль не мутує нічого: запис у `.cspell.json` виконує лише `fix-worker.mjs` через `appendWordsToDict`.
- Файли поза скоупом `cspell` (ignorePaths) ніколи не трактуються як порушення.
