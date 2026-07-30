---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/project/main.mjs
docgen:
  crc: 75827daf
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

lint-поверхня php/project: read-only detector (`composer audit` + `mago analyze`),
перейменовано з колишнього bundled `php/check` (spec
docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). PHPStan/Psalm замінено
на `mago analyze` (spec `docs/specs/2026-07-30-mago-php-toolchain.md`) — `composer audit`
лишається обов'язковим байт-у-байт як раніше. `full`, без `lint.glob` — mago analyze
потребує повного project-graph (autoload, class hierarchy), запуск на одному файлі дає
неповний/хибний результат; composer audit — project-wide dependency audit. Не входять у
delta-план (§5): спрацьовують лише через `n-rules lint --full` або scoped `n-rules lint php`.

Nested Composer workspaces (ADR `2026-07-27-nested-composer-workspace-detection`): цей
детектор свідомо читає лише кореневий `composer.json` (`ctx.cwd`) — вкладені Composer-проєкти
(`services/api/composer.json`) активують правило `php` (auto.glob до глибини 2), і кожен
`.php`-файл лінтиться per-file концернами `mago_fmt`/`mago_lint` незалежно від того, під яким
вкладеним composer.json він лежить, але НЕ проганяються тут через `composer audit`/`mago
analyze`. Деталі й обґрунтування — `docs/adr/`, `tooling/tooling.mdc`.

## Публічний API

- extractPhpVersion — Витягує мінімальну PHP-версію (наприклад `"8.2"`) з composer-constraint `require.php` для
`mago --php-version` (`mago analyze` перевіряє синтаксис/типи під конкретну версію PHP,
а не сканує весь діапазон constraint-у). Composer-синтаксис constraint-ів (caret/tilde/OR-range)
не парситься повністю — береться перше число-в-числі у рядку, що покриває типові форми
(`>=8.2`, `^8.2`, `~8.2.0`, `8.2.*`); складніші вирази (OR-range `"8.1 || 8.2"`) дадуть перше
знайдене число, що є прийнятним наближенням «мінімальної підтримуваної версії».
- lint — Detector php/project (read-only). Async — `runTool` викликає `spawnAsync` (ADR 260716-1354).

## Сценарії використання

- `plugins/lang-php/rules/php/project/tests/main.test.mjs` (extractPhpVersion; php/project detector) — немає composer.json → без порушень, жоден тул не викликається; composer.json є, composer відсутній у PATH → composer-missing, mago не резолвиться; composer audit падає → composer-audit-violation, mago analyze НЕ викликається (short-circuit); composer audit OK, немає require.php → mago analyze без --php-version; composer audit OK, require.php =; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
