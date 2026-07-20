# Changelog

## [0.9.0] - 2026-07-20

### Added

- doc-files: Vue SFC-екстрактор (`.vue` через optional peer `vue/compiler-sfc`) — props/emits/exposed як псевдо-експорти, слоти з `@slot`-коментарів шаблону, юніти зі зміщеними у файл офсетами

### Fixed

- doc-files: JSDoc-атрибуція експортів/юнітів через реальні AST-коментарі парсера (не regex по сирому тексту) — усуває false positive, коли '/**'-подібний текст трапляється всередині // -коментаря чи рядкового літералу

## [0.8.0] - 2026-07-20

### Added

- doc-files: Vue SFC-екстрактор (`<script setup>`) — extractFactsVue/extractUnitsVue через optional peer vue/compiler-sfc; props/emits/expose/слоти як публічний контракт, юніти зі span-корекцією (ADR 260719-2155)

## [0.7.1] - 2026-07-20

### Fixed

- style/lint: stylelint — задекларована залежність плагіна (раніше резолвилась лише транзитивно у цьому монорепо через @nitra/stylelint-config); відсутність тула тепер дає видимий warn-diagnostic замість мовчазного no-op (незалежний консюмер бачив би 'зелений' style-лінт, який насправді нічого не перевіряв)

## [0.7.0] - 2026-07-19

### Added

- правило test з ядра: розміщення тест-файлів у tests/, ізоляція (no-process-chdir, no-relative-fs-path, no-console-store-restore, sandbox-aware-test, no-bun-test-import), канон vitest/stryker конфігів і vitest-api-конвенції — без cargo-mutants (він у правилі rust плагіна lang-rust)

## [0.6.0] - 2026-07-19

### Added

- правило style з ядра (stylelint-детектор css/scss/vue, тулінг-канон, quasar/admin-table/colors/gap-концерни) — фронтенд-сімʼя правил тепер повністю у плагіні

## [0.5.0] - 2026-07-19

### Added

- skipLocalTier для js-run/runtime: local-tier емпірично 0/14 успіхів (llm-trace.jsonl), cloud-tier — 3/6; ladder одразу стартує з cloud-min (ADR 260718-0754)

## [0.4.1] - 2026-07-19

### Fixed

- js/knip: вбудований ігнор unused-dependency на пакети екосистеми n-rules (@7n/rules і @7n/rules-* плагіни — їх ставить сам npx @7n/rules, код споживача не імпортує) + канон knip ignoreDependencies з тим самим патерном

## [0.4.0] - 2026-07-19

### Added

- JS-сімʼя lint-правил з ядра (фаза 5c spec lang-plugins-extraction): js, bun, vue, js-run, js-bun-db, js-bun-redis, js-mssql, npm-module, tool-surface — плагін тепер contributes.rules з власними залежностями інструментів (eslint, oxlint, knip, jscpd, oxc-parser, globby, ignore); спільні з рушієм хелпери (globToRegex, textHasBunSqlImport, contentForVueImportScan) імпортуються з ядра і ре-експортуються для сумісності API

## [0.3.1] - 2026-07-19

### Fixed

- extractors.test.mjs: імпорт з ../extractors.mjs замість неіснуючого ../main.mjs (хвіст перейменування фази 5b; knip unresolved)

## [0.3.0] - 2026-07-19

### Added

- doc-files-екстрактори JS-екосистеми (фаза 5b spec lang-plugins-extraction): маніфест декларує розширення js/mjs/ts/vue з OKF-типами (contributes.docFiles.extensions) і handler doc-files; extractFacts (факт-лист js/mjs/ts, .vue → whole-file) та extractUnits (oxc AST юніт-шар) переїхали з ядра — генерація док для JS-файлів тепер вмикається цим плагіном

### Fixed

- knip duplicates `jsProvider|default`: провайдер тепер експортується лише як default (як у lang-rust/lang-python), named-експорт `jsProvider` прибрано

## [0.2.0] - 2026-07-19

### Added

- Перший реліз: EcosystemProvider npm/bun для taze-оркестратора `@7n/rules` (extension-point `taze`, контракт `@7n/rules/plugin-api`) — фаза 5a spec lang-plugins-extraction: JS-екосистема стала таким самим плагіном, як Rust/Python, ядро — двигун без мовної специфіки. Бекап package.json воркспейсів, bump через `bunx taze -w -r latest` + `bun install`, детермінований `collectTazeDiff` (semver caret-класифікація), CLI `n-rules taze diff` — через handler плагіна. Автодетект — за кореневим `package.json`

All notable changes to this project will be documented in this file.
