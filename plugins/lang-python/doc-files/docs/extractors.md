---
type: JS Module
title: extractors.mjs
resource: plugins/lang-python/doc-files/extractors.mjs
docgen:
  crc: 5c0349a2
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Витягує Python module/class/function docstring-и для дослівної doc-files-документації.
Завдяки цьому повністю прокоментований Python-файл не потребує LLM-генерації.

## Публічний API

- extractFactsPython — Витягує факт-лист Python без AST-залежності: module/class/function docstring-и
стають авторитетними полями `header` та `exports` для zero-LLM doc-files.

## Сценарії використання

- `plugins/lang-python/doc-files/tests/extractors.test.mjs` (extractFactsPython) — module та public def docstring-и стають дослівними facts; підтримує багаторядкові module та class docstring-и; не вважає непокритий public API повною документацією; handler декларує Python extension

## Гарантії поведінки

- Кешує результати в межах одного прогону.
