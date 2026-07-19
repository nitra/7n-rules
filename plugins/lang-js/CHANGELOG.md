# Changelog

## [0.3.0] - 2026-07-19

### Added

- doc-files-екстрактори JS-екосистеми (фаза 5b spec lang-plugins-extraction): маніфест декларує розширення js/mjs/ts/vue з OKF-типами (contributes.docFiles.extensions) і handler doc-files; extractFacts (факт-лист js/mjs/ts, .vue → whole-file) та extractUnits (oxc AST юніт-шар) переїхали з ядра — генерація док для JS-файлів тепер вмикається цим плагіном

### Fixed

- knip duplicates `jsProvider|default`: провайдер тепер експортується лише як default (як у lang-rust/lang-python), named-експорт `jsProvider` прибрано

## [0.2.0] - 2026-07-19

### Added

- Перший реліз: EcosystemProvider npm/bun для taze-оркестратора `@7n/rules` (extension-point `taze`, контракт `@7n/rules/plugin-api`) — фаза 5a spec lang-plugins-extraction: JS-екосистема стала таким самим плагіном, як Rust/Python, ядро — двигун без мовної специфіки. Бекап package.json воркспейсів, bump через `bunx taze -w -r latest` + `bun install`, детермінований `collectTazeDiff` (semver caret-класифікація), CLI `n-rules taze diff` — через handler плагіна. Автодетект — за кореневим `package.json`

All notable changes to this project will be documented in this file.
