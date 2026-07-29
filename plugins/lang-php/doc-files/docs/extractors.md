---
type: JS Module
title: extractors.mjs
resource: plugins/lang-php/doc-files/extractors.mjs
docgen:
  crc: 3349fa3d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Витягує PHP docblock-и (`/** ... *​/` над class/interface/trait/enum/function/public
method) для дослівної doc-files-документації — аналог `lang-python/doc-files/extractors.mjs`,
але без AST/парсера PHP: чистий рядковий скан регулярними виразами, без зовнішніх
залежностей і без запуску `php`.

## Публічний API

- extractFactsPhp — Витягує факт-лист PHP без парсера/запуску `php`: file-level і per-декларація docblock-и
  стають авторитетними полями `header` та `exports` для zero-LLM doc-files.

## Сценарії використання

- `plugins/lang-php/doc-files/tests/extractors.test.mjs` (extractFactsPhp) — file-level і class/method docblock-и стають дослівними facts; підтримує багаторядкові docblock-и й обриває опис на першому тезі; не вважає непокритий public API повною документацією; top-level function отримує docblock, private/protected методи пропускаються; розпізнає trait/enum як top-level декларації; ще 6

## Гарантії поведінки

- Кешує результати в межах одного прогону.
