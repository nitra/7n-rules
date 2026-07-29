---
type: JS Module
title: extractor.mjs
resource: plugins/lang-php/knowledge/extractor.mjs
docgen:
  crc: c1ed8bb6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Будує fail-closed normalized fragments для PHP package-knowledge через php-parser AST.
Regex і brace-scanner не беруть участі у production semantic extraction.

## Поведінка

analyzeFile приймає вхідні дані для вилучення знань і повертає повний семантичний фрагмент або результат, що блокує обробку.

collectTestScenarios приймає джерело тесту і повертає сценарії тестів або діагностику, яка блокує процес.

Відсутні механізми для роботи з кешуванням.

Помилки в процесі аналізу обробляються за принципом "fail-closed", що означає, що збою призводить до повернення статусу неможливості виконання.

## Публічний API

- analyzeFile — Аналізує PHP source через повний parser та повертає only-complete semantic fragment.
- collectTestScenarios — Збирає active PHPUnit test* methods з assert* call через php-parser AST.

## Сценарії використання

- `plugins/lang-php/knowledge/tests/extractor.test.mjs` (knowledge.extractor@1 PHP adapter) — declares the full PHP parser contract and its only extension; extracts public/private units, imports, calls, chunks and complete UTF-8 coverage; malformed syntax blocks publication without partial graph or fallback; unsupported file extension is a structured blocking diagnostic; collects asserted active PHPUnit test methods but excludes skipped and helper methods; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
