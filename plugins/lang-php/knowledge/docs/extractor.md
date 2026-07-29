---
type: JS Module
title: extractor.mjs
resource: plugins/lang-php/knowledge/extractor.mjs
docgen:
  crc: 35972a52
---

## Огляд

PHP knowledge extractor будує normalized semantic fragment лише з AST, отриманого
повним `php-parser`. Parser failure або непідтримуваний файл повертає blocking
diagnostic без partial graph і fallback.

## Публічний API

- analyzeFile — Аналізує один PHP source-файл, формує units, imports, semantic
  edges, chunks і complete coverage ledger з UTF-8 byte spans.

## Гарантії поведінки

- Private units лишаються evidence, а public units стають entry points.
- Cross-package `use`/static calls подаються як opaque integrations.
