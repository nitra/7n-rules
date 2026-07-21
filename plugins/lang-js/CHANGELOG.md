# Changelog

## [0.11.0] - 2026-07-21

### Added

- storybook: новий concern `ci` (ADR Кластер 5, CI-частина) — канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і `.github/workflows/lint-storybook.yml` (швидкий PR-прогін `vitest --project=storybook`), гейтований `requires.capability: ci:github`

### Fixed

- storybook: viteFinal-фільтр стійкий до VueMacros-стека (Promise/масив-резолв, сімейний фільтр vite:*/vue-macros), vitest@^4 provider-factory (@vitest/browser-playwright) замість застарілого рядка `'playwright'`, flat-root layout у detectStoriesGlob (components без src/), точковий alias-мок одного модуля в mocking.mdc, і STORIES_RE false positive на `storybookTest({ configDir })` без явного include — усе за результатами пілота adopt-діагностики на nitra/components. Заодно governance package_json.rego: allowlist доповнено `@vitest/browser-playwright`.

## [0.10.0] - 2026-07-21

### Added

- storybook: канон Storybook хвилі 1 для Vue-компонентних бібліотек — детекція скоупу (isVueComponentLibraryPkg, поріг ≥3 .vue, opt-out), канонічний скафолд .storybook/main.js+preview.js+mocks/gql-sse.js, package.json#scripts.storybook (ADR канон-storybook-для-vue-компонентних-бібліотек)
- npm-module/bun: governance-виняток канону Storybook (кластер 7 ADR канон-storybook-для-vue-компонентних-бібліотек) — npm_package_json.rego дозволяє канонічні Storybook-devDeps (storybook, @storybook/vue3-vite, @storybook/vue3, msw, msw-storybook-addon) у npm/package.json із зафіксованою точною версією (deny на неканонічний пакет або неканонічну версію); bun/package_json.rego розширює root-only test peers на @vitest/browser + playwright (browser-mode provider для named vitest project "storybook", лише chromium) та @storybook/addon-vitest (storybookTest-плагін того самого vitest-конфіга) — Storybook-identity-пакети у корінь свідомо не додаються
- storybook: vitest-config-концерн хвилі 1 (ADR Кластер 5) — canonical test.projects unit+storybook (browser-mode, лише chromium, stories-glob) дописується поверх наявного vitest-конфіга, ізольований vitest.stryker.config генерується поруч (Stryker крашиться на browser-mode projects)
- storybook: концерни mocking (docs-only рецепти router/tfm/Apollo-MSW/Pinia/page-story) і hygiene (undeclared third-party imports у .vue, auto-detect sassVariables) — ADR Кластер 3/6

### Fixed

- storybook: підключено concern-и scope/scaffold/vitest-config до unified lint-рушія (lint-блок у concern.json — check:true без lint мовчки ігнорувався run-detectors.mjs), додано --adopt-режим (adopt/main.mjs) і скіл n-storybook

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
