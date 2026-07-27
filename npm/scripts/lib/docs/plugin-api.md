---
type: JS Module
title: plugin-api.mjs
resource: npm/scripts/lib/plugin-api.mjs
docgen:
  crc: 31cf4e7d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічний API `@7n/rules/plugin-api` для плагінів `@7n/rules`: у фазі 1 він визначає один порт — `EcosystemProvider` для taze — і контракт підключення через `package.json`-маніфест плагіна: `"n-rules": { "contributes": { "handlers": { "taze": "./taze/provider.mjs" } } }`. Модуль-обробник `./taze/provider.mjs` експортує провайдера як `default`. Тут же живуть спільні semver-правила для всіх мовних плагінів: `parseVersion`, `isBreaking`, `PLUGIN_API_VERSION`, `assertCoverageProvider`, `assertEcosystemProvider`. Це єдине джерело правил без імпорту внутрішніх шляхів `@7n/rules` і без циклу `plugin-api ↔ плагін`; наступні порти додаються окремими фазами й наперед не проєктуються.

## Поведінка

`PLUGIN_API_VERSION` задає спільну версію контракту для плагінів і узгоджує очікування між оркестратором та handler-модулями, які приходять із `package.json`.

`parseVersion` витягає лише semver-ядро зі specifier-а, щоб далі можна було порівнювати версії в єдиному форматі, а не працювати з range-префіксами чи non-semver значеннями.

`isBreaking` використовує вже нормалізовані ядра версій і визначає, чи перехід між ними змінює найлівішу ненульову компоненту, тобто чи треба вважати зміну breaking.

`assertEcosystemProvider` і `assertCoverageProvider` приймають default-експорт handler-модуля, перевіряють його форму на межі плагіна і повертають той самий об’єкт лише тоді, коли він придатний для подальшого використання без прихованих помилок у глибині оркестратора.

Разом ці точки входу формують один шлях: конфігурація з `package.json` визначає, який handler підвантажити, handler віддає провайдера як default export, а спільні semver-правила й валідація контракту гарантують, що інтеграція лишається передбачуваною для всіх мовних плагінів.

## Публічний API

- parseVersion — Парсить semver-ядро зі specifier-а (ігнорує range-префікси `^`/`~`/`>=` тощо).
- isBreaking — Чи є перехід `from → to` breaking за caret-семантикою (змінилась найлівіша
ненульова компонента).
- PLUGIN_API_VERSION — Версія контракту plugin-api: плагін декларує `requiresPluginApi`, несумісність → skip, не креш.

`2` (spec 2026-07-27-universal-plugin-slots-lang-php-extraction, Фаза 1) — breaking envelope
зміна: universal typed slot bus (`n-rules.slots.{provides,consumes}`, `resolveSlotGraph` у
`plugin-slots.mjs`) замінює `contributes.rules/handlers/docFiles` як цільовий контракт.
Legacy `contributes.*` лишається робочим до Фази 2 (повна first-party migration) — версія тут
підіймається одразу, бо саме `requiresPluginApi` є enforcement-точкою: плагін без цього поля
або зі старим значенням у slot graph не потрапляє (діагностика, не крах); legacy-поверхні й
далі обслуговують його contributes-based contributions без змін.
- assertCoverageProvider — Валідує форму coverage-провайдера з модуля плагіна.
- assertEcosystemProvider — Валідує форму провайдера з модуля плагіна — зрозуміла помилка замість
«undefined is not a function» глибоко в оркестраторі.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
