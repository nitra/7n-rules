---
type: JS Module
title: extractors.mjs
resource: plugins/lang-python/doc-files/extractors.mjs
docgen:
  crc: 77d310c4
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Витягує Python module/class/function docstring-и для дослівної doc-files-документації.
Завдяки цьому повністю прокоментований Python-файл не потребує LLM-генерації.

## Публічний API

- extractFactsPython — Витягує факт-лист Python без AST-залежності: module/class/function docstring-и
стають авторитетними полями `header` та `exports` для zero-LLM doc-files.

## Сценарії використання

- `plugins/lang-python/doc-files/tests/extractors.test.mjs` — extractFactsPython
- `plugins/lang-python/doc-files/tests/extractors.test.mjs` — module та public def docstring-и стають дослівними facts
- `plugins/lang-python/doc-files/tests/extractors.test.mjs` — підтримує багаторядкові module та class docstring-и
- `plugins/lang-python/doc-files/tests/extractors.test.mjs` — не вважає непокритий public API повною документацією
- `plugins/lang-python/doc-files/tests/extractors.test.mjs` — handler декларує Python extension

## Гарантії поведінки

- Кешує результати в межах одного прогону.
