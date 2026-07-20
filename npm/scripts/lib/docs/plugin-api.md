---
type: JS Module
title: plugin-api.mjs
resource: npm/scripts/lib/plugin-api.mjs
docgen:
  crc: c614a880
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічний API для плагінів `@7n/rules` (експорт `@7n/rules/plugin-api`). У фазі 1 (`spec 2026-07-18-lang-plugins-extraction`) реалізовано порт `EcosystemProvider` для `taze`. Плагін реєструє провайдера через маніфест `package.json`: `"n-rules": { "contributes": { "handlers": { "taze": "./taze/provider.mjs" } } }`, причому модуль-обробник експортує об'єкт провайдера як `default`. Публічні функції включають `PLUGIN_API_VERSION` та `assertEcosystemProvider`. Ядро реекспортує Semver-утиліти для коректної класифікації major/minor версій плагінами, використовуючи той самий принцип caret-семантики, що й ядро, без дублювання коду та імпорту внутрішніх шляхів `@7n/rules`.

## Поведінка

- PLUGIN_API_VERSION визначає версію контракту plugin-api.
- assertEcosystemProvider перевіряє, чи об'єкт, наданий плагіном, відповідає очікуваній структурі EcosystemProvider, і викидає відповідну помилку, якщо він не валідний.

## Публічний API

- PLUGIN_API_VERSION — версія контракту plugin-api; плагін декларує `requiresPluginApi`, несумісність дає зрозумілий skip, не креш.
- isBreaking / parseVersion — реекспорт semver-утиліт ядра для однакової класифікації major/minor у плагінах.
- assertEcosystemProvider — перевіряє, чи має default-експорт handler-модуля плагіна необхідну форму EcosystemProvider, щоб система могла виявити помилку чітко замість непередбачуваної.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
