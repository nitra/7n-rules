# Changelog

## [0.2.0] - 2026-07-18

### Added

- Перший реліз: EcosystemProvider Rust/Cargo для taze-оркестратора `@7n/rules` (extension-point `taze`, контракт `@7n/rules/plugin-api`) — виніс із ядра фазою 2 spec lang-plugins-extraction без зміни сигнатур порту. Детермінований `collectCargoDiff` (усі Cargo.toml workspace-у через `smol-toml`, caret-семантика включно зі скороченими версіями `"1"`/`"0.4"`), bump через `cargo upgrade --incompatible allow` + `cargo update`, graceful skip без установленого cargo-edit. Автодетект плагіна — за кореневим `Cargo.toml`

All notable changes to this project will be documented in this file.
