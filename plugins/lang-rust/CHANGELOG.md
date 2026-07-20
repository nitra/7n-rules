# Changelog

## [0.6.0] - 2026-07-19

### Added

- концерн cargo_mutants_config у правилі rust (переїхав з правила test ядра): канонічний baseline .cargo/mutants.toml на кожен Cargo.toml-маніфест, T0-fix генерації; активація за glob Cargo.toml — у rust-only репо працює без lang-js

## [0.5.1] - 2026-07-19

### Fixed

- knip unresolved: JSDoc-типи lint-surface тепер через пакетний шлях `@7n/rules/scripts/lib/lint-surface/types.mjs` замість неіснуючого відносного `../../../scripts/...`

## [0.5.0] - 2026-07-19

### Added

- SKILL-фрагмент taze (фаза 4b spec lang-plugins-extraction): Rust-гілка SKILL.md (детекція Cargo.toml, per-manifest cargo upgrade/update, collectCargoDiff, cargo fmt/clippy/test, примітка про --incompatible allow) тепер живе у плагіні (`skills/taze/SKILL.fragment.md`) і доклеюється sync-ом до скіла в репо з активним плагіном

## [0.4.0] - 2026-07-18

### Added

- doc-files-екстрактори Rust переїхали з ядра (фаза 4a spec lang-plugins-extraction): `extractFactsRust` (header/exports/imports/markers) і `extractUnitsRs` — handler extension-point `doc-files`; розширення `.rs` → 'Rust Module' декларується маніфестом (`contributes.docFiles.extensions`)

## [0.3.0] - 2026-07-18

### Added

- Правило `rust` переїхало з ядра (фаза 3 spec lang-plugins-extraction): main.mdc, концерни applies/check/package_json/vscode_extensions з rego-політиками й шаблонами — плагін тепер contributes.rules; дзеркало `.cursor/rules/n-rust.mdc` і auto-rules детект працюють через плагінне джерело

## [0.2.2] - 2026-07-18

### Fixed

- Репо без кореневого Cargo.toml (вкладені крейти, як Tauri `src-tauri`): bump іде per-manifest через `--manifest-path` замість голого `cargo upgrade` з кореня (падав «could not find Cargo.toml»); бекап покриває і Cargo.lock поруч із кожним маніфестом (незалежні крейти мають власні lock-файли); `findCargoManifests` виключає `.claude/worktrees/`. Знайдено live-прогоном на реальному Tauri-репо

## [0.2.1] - 2026-07-18

### Fixed

- taze/provider: прибрано дублювальний named-експорт `rustProvider` (лишився default) — фікс knip duplicates/exports (той самий патерн, що в lang-python)

## [0.2.0] - 2026-07-18

### Added

- Перший реліз: EcosystemProvider Rust/Cargo для taze-оркестратора `@7n/rules` (extension-point `taze`, контракт `@7n/rules/plugin-api`) — виніс із ядра фазою 2 spec lang-plugins-extraction без зміни сигнатур порту. Детермінований `collectCargoDiff` (усі Cargo.toml workspace-у через `smol-toml`, caret-семантика включно зі скороченими версіями `"1"`/`"0.4"`), bump через `cargo upgrade --incompatible allow` + `cargo update`, graceful skip без установленого cargo-edit. Автодетект плагіна — за кореневим `Cargo.toml`

All notable changes to this project will be documented in this file.
