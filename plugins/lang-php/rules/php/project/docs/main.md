---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/project/main.mjs
docgen:
  crc: 69f93307
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

lint-поверхня php/project: read-only detector (`composer audit` + PHPStan + Psalm),
перейменовано з колишнього bundled `php/check` (spec
docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). `full`, без `lint.glob` —
phpstan/psalm потребують повного project-graph (autoload, class hierarchy), запуск на
одному файлі дає неповний/хибний результат; composer audit — project-wide dependency
audit. Не входять у delta-план (§5): спрацьовують лише через `n-rules lint --full` або
scoped `n-rules lint php`.

Nested Composer workspaces (ADR `2026-07-27-nested-composer-workspace-detection`): цей
детектор свідомо читає лише кореневий `composer.json`/`vendor/bin/*` (`ctx.cwd`) — вкладені
Composer-проєкти (`services/api/composer.json`) активують правило `php` (auto.glob до глибини
2), і кожен `.php`-файл лінтиться per-file концернами `cs_fixer`/`phpcs` незалежно від того,
під яким вкладеним composer.json він лежить, але НЕ проганяються тут через
`composer audit`/PHPStan/Psalm. Деталі й обґрунтування — `docs/adr/`, `tooling/tooling.mdc`.

## Публічний API

- lint — Detector php/project (read-only). Async — `runTool` викликає `spawnAsync` (ADR 260716-1354).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
