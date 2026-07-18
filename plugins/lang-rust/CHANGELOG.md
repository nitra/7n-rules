# Changelog

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
