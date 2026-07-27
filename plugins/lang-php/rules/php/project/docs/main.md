---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/project/main.mjs
docgen:
  crc: 30595da1
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 65
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

lint-поверхня php/project: read-only detector (`composer audit` + PHPStan + Psalm),
перейменовано з колишнього bundled `php/check` (spec
docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). `full`, без `lint.glob` —
phpstan/psalm потребують повного project-graph (autoload, class hierarchy), запуск на
одному файлі дає неповний/хибний результат; composer audit — project-wide dependency
audit. Не входять у delta-план (§5): спрацьовують лише через `n-rules lint --full` або
scoped `n-rules lint php`.

## Публічний API

- lint — Detector php/project (read-only). Async — `runTool` викликає `spawnAsync` (ADR 260716-1354).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
