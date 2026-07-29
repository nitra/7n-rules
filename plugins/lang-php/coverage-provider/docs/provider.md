---
type: JS Module
title: provider.mjs
resource: plugins/lang-php/coverage-provider/provider.mjs
docgen:
  crc: 3c07252f
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
---

## Огляд

CoverageProvider PHP-екосистеми (порт `coverage` plugin-api, spec
2026-07-22 absorb-7n-test): line/function coverage через PHPUnit/Pest
(`--coverage-clover`, clover.xml) і мутаційне тестування через
`infection/infection` (`--logger-json`). Методи викликає концерн
`coverage` правила `test` ядра — CLI-оркестрації тут немає. Відсутній
тулчейн (`vendor/bin/phpunit`/`vendor/bin/pest`) — чесний skip з
одноразовим hint, не помилка (та сама семантика, що rust-провайдер).
Fix-hooks (LLM-генерація тестів) для PHP поки не реалізовані.

## Публічний API

- defaultRunner — Дефолтний spawn-runner провайдера (composer/vendor-виклики; інжектовний у тестах).

## Сценарії використання

- `plugins/lang-php/coverage-provider/tests/provider.test.mjs` (контракт провайдера; defaultRunner.hasVendorBin (реальна файлова система)) — id/title/detect/collect/collectPerFile присутні; файл є у vendor/bin → true; файла немає → false; без composer.json → false; composer.json без тестового сигналу (ні phpunit.xml, ні Pest) → false; ще 13

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
