---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/composer_manifest/main.mjs
docgen:
  crc: a4f0cfad
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

lint-поверхня php/composer_manifest: канон кореневого `composer.json` (у дусі
`npm-module` для `package.json`). Read-only detector, `full`-scope. Декларативні
перевірки (JSON-парсинг, `config.sort-packages`, `license`, `require.php`) працюють
завжди — навіть без встановленого `composer`; `composer validate --strict
--no-check-publish` — лише якщо `composer` є в PATH (відсутність — тихий skip,
`composer-missing` як окрему причину порушення репортить `php/project`).

## Публічний API

- lint — Detector php/composer_manifest (read-only). Async — `spawnAsync` для `composer validate`
може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).

## Сценарії використання

- `plugins/lang-php/rules/php/composer_manifest/tests/main.test.mjs` (php/composer_manifest detector) — немає composer.json → без порушень, spawnAsync/resolveCmd не викликаються; канонічний composer.json, composer відсутній у PATH → без порушень (тихий skip validate); канонічний composer.json, composer є, validate успішний → без порушень; битий JSON → composer-manifest-invalid-json, без винятку, composer не викликається; config.sort-packages не true → composer-manifest-sort-packages; ще 7

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
