---
type: JS Module
title: extractor.mjs
resource: plugins/lang-php/knowledge/extractor.mjs
docgen:
  crc: f7545bec
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Будує fail-closed normalized fragments для PHP package-knowledge через php-parser AST.
Regex і brace-scanner не беруть участі у production semantic extraction.

## Публічний API

- analyzeFile — Аналізує PHP source через повний parser та повертає only-complete semantic fragment.
- collectTestScenarios — Збирає assertions лише з active PHP test methods через php-parser.

## Сценарії використання

- `plugins/lang-php/knowledge/tests/extractor.test.mjs` (knowledge.extractor@1 PHP adapter) — declares the full PHP parser contract and its only extension; extracts public/private units, imports, calls, chunks and complete UTF-8 coverage; malformed syntax blocks publication without partial graph or fallback; unsupported file extension is a structured blocking diagnostic

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
