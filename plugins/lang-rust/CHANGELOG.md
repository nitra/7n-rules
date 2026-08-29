# Changelog

## [0.18.0] - 2026-08-29

### Removed

- Знято всі ЧОТИРИ JS-канони T0-фікса плагіна: `rules/rust/doc_comments/fix-doc_comments.mjs`, `rules/rust/check/fix-check.mjs`, `rules/rust/cargo_mutants_config/fix-cargo_mutants_config.mjs`, `rules/rust/vscode_extensions/fix-vscode_extensions.mjs`. Кожен із цих концернів має фікс у wasm-гості `crates/plugin-lang-rust`, і тепер гість — ЄДИНА реалізація, а не пріоритетна з JS-fallback-ом. Борг «спершу парність» на цьому плагіні закрито повністю.

Спостережувана поведінка `--fix` не змінилась: гість і доти мав пріоритет (`T0Pattern.guestFix`). Звірку порядково зроблено перед видаленням, і в жодному з чотирьох концернів канон не робив того, чого не робить гість. Розбіжності — на користь гостя й уже задокументовані хвилями порту: guard ідемпотентності в `doc_comments`, `include_str!`-вшитий baseline у `cargo_mutants_config` (шаблон не може «зникнути з пакета»), гучний `LogLevel::Error` там, де канон `rust/check` мовчки віддавав порожній результат (`cargo` не резолвиться; провалений `cargo fmt --all`).

Канони-ДЖЕРЕЛА лишились на місці й нікуди не діваються: `concern.json`, `vscode_extensions.rego`, `template/**` і обидва data-файли (`check/data/check/deny.toml.minimal`, `cargo_mutants_config/data/cargo_mutants_config/mutants.toml.baseline`) — гість вшиває їх `include_str!`-ом, тож detect-парність через справжній `conftest` і байт-у-байт звірка скаффолда `deny.toml` лишились живими.

Практичний наслідок, який варто знати: fallback-у більше немає. Якщо wasm-компонент `lang-rust` у консюмері не резолвиться (плагін не зібрано, розбіжність піна, хост без wasm), кожен із чотирьох концернів деградує з «автофікс» у «порушення показано, концерн пішов у LLM-ладдер» — раніше цей випадок гасив JS-канон.

Деталі, порядкова звірка й повний облік тестів — §2.91 `docs/plans/2026-08-05-open-questions-register.md`.

## [0.17.3] - 2026-08-29

### Changed

- `rust/vscode_extensions`: концерн тепер обслуговує wasm-гість `crates/plugin-lang-rust` — і детект (вшитий `.rego` через host-import `rego-engine`, замість субпроцесу `conftest`), і T0-фікс (порт `vscode-ext-add.mjs`). У `vscode_extensions.rego` Go-верб `%q` замінено на еквівалентний для рядків `\"%v\"` — `regorus` `%q` не підтримує; текст повідомлення не змінився. Додатково: JSONC-вхід (`//`-коментарі) тепер читається, а справді побитий файл дає видиму діагностику замість мовчазного пропуску (§2.77)

## [0.17.2] - 2026-08-29

### Changed

- `rust/check`: мінімальний скаффолд `deny.toml` винесено з літерала `fix-check.mjs` у data-файл `rules/rust/check/data/check/deny.toml.minimal` — той самий асет тепер вшиває wasm-порт фіксера (`include_str!`, `crates/plugin-lang-rust`), тож дві реалізації не можуть розійтися беззвучно. Поведінка фіксера не змінилась

## [0.17.1] - 2026-08-27

### Changed

- `engines.bun` піднято з `>=1.3` до `>=1.4` — репо-мінімум `js.package_json` (репо фактично вимагає 1.4)

## [0.17.0] - 2026-08-24

### Removed

- rust-концерни (усі шість): видалено JS lint-детектори (main.mjs) — канон тепер wasm-гість crates/plugin-lang-rust; T0-фіксери, rego-концерни, lib/ignored-dirs.mjs і тести декларативного гейта лишаються JS

## [0.16.1] - 2026-08-05

### Fixed

- rust/wasm_component: findDependency без implicit fallthrough return (jsdoc/require-returns-check)

## [0.16.0] - 2026-08-05

### Added

- rust/wasm_component: новий концерн — забороняє старий (pre-Component-Model) режим wasm. `wasm-bindgen` (пряма чи workspace-успадкована залежність, у будь-якій depend-таблиці, включно з `[target.'cfg(...)'.*]`) заборонено — гостьовий wasm-код має йти через `wit-bindgen` + ціль wasm32-wasip2. `wasmtime` з `default-features = false` без `component-model` у `features` теж заборонено (у `wasmtime` це дефолтна feature, тож проста форма `wasmtime = "…"` вже проходить).

## [0.15.4] - 2026-08-05

### Changed

- Гейт правила `rust` переїхав з виконуваного `rust/applies/main.mjs` у декларативне поле `main.json:applies` (`globMatches` по `**/Cargo.toml` з явним `ignoreDirs`). Умова застосовності не змінилась — правило вмикається, якщо в дереві є хоч один `Cargo.toml` поза службовими каталогами; список ігнорованих імен (зокрема `.worktrees`, `vendor`, `.claude`) тепер живе в `main.json` як дані й звіряється з `lib/ignored-dirs.mjs` тестом-конвенцією. Rule-local утиліта `lib/has-cargo-toml.mjs` більше не потрібна й видалена — обхід дерева робить спільний рушій предиката.

## [0.15.3] - 2026-07-30

### Changed

- release: @7n/rules@1.59.0, @7n/rules-ci-github@2.2.0, @7n/rules-lang-js@0.25.2, @7n/rules-lang-php@0.2.8, @7n/rules-lang-python@0.12.2, @7n/rules-lang-rust@0.15.2; fix(plugins): audit follow-ups — php vscode extensions, llm-lib peers, lint-style vue patch (#307)

## [0.15.2] - 2026-07-30

### Changed

- Peer `@7n/llm-lib` звужено з `*` до `>=1.2.0` — фактично потрібний API (`agent-fix` + `model-tiers`, `opts.chain`/`opts.targetFiles`), єдине production-використання — `coverage-provider/fix-hooks.mjs` (динамічний import, dependency ядра `@7n/rules`, не плагіна).

## [0.15.1] - 2026-07-30

### Fixed

- Уніфіковано LLM model resolution у execution consumers та оновлено native addon для env-selector policy.

## [0.15.0] - 2026-07-30

### Added

- Додано Tree-sitter WASM knowledge extractor для Rust.

## [0.14.3] - 2026-07-29

### Added

- Rust CI-артефакти (lint-rust.yml, azure lint-степ) через ci.artifact@1 slot contributions

## [0.14.2] - 2026-07-29

### Changed

- Виправлено правопис у документації Rust-екстрактора.

## [0.14.1] - 2026-07-27

### Fixed

- peerDependency @7n/rules піднято до >=1.52.0 — перша core-версія з universal slot bus (plugin API v2)

## [0.14.0] - 2026-07-27

### Changed

- Перехід на використання slots у package.json для реєстрації плагіна

## [0.13.1] - 2026-07-27

### Changed

- fix(llm-lib): align native addon packages (#228)

## [0.13.0] - 2026-07-25

### Changed

- Rust-крейти перейменовано: llm-cascade → llm-lib, llm-cascade-napi → llm-lib-napi, CascadeError → LlmError; napi-артефакти llm-lib-napi.`triple`.node; git-споживачам — dependency-alias llm-cascade = { package = "llm-lib" }
- changelog presence: додано change-файл для змін у plugins/lang-rust

## [0.12.0] - 2026-07-24

### Added

- coverage-провайдер Rust: cargo llvm-cov (line coverage) + cargo-mutants (мутаційний вимір) за портом CoverageProvider — full і делта-шляхи концерну coverage правила test
- coverage: fix-hooks generateTests/fixSurvived (runAgentFix) + comment-only ігнор у делті

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.11.0] - 2026-07-23

### Added

- coverage-провайдер Rust: cargo llvm-cov (line coverage) + cargo-mutants (мутаційний вимір) за портом CoverageProvider — full і делта-шляхи концерну coverage правила test
- coverage: fix-hooks generateTests/fixSurvived (runAgentFix) + comment-only ігнор у делті

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.10.0] - 2026-07-23

### Added

- coverage-провайдер Rust: cargo llvm-cov (line coverage) + cargo-mutants (мутаційний вимір) за портом CoverageProvider — full і делта-шляхи концерну coverage правила test
- coverage: fix-hooks generateTests/fixSurvived (runAgentFix) + comment-only ігнор у делті

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.9.0] - 2026-07-23

### Added

- coverage-провайдер Rust: cargo llvm-cov (line coverage) + cargo-mutants (мутаційний вимір) за портом CoverageProvider — full і делта-шляхи концерну coverage правила test

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.8.1] - 2026-07-22

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.8.0] - 2026-07-22

### Added

- rust/doc_comments: рекомендовані вимоги до rustdoc-коментарів (//!-header файлу з pub-елементами, ///-опис над кожним top-level pub-елементом) з T0-підвищенням суміжних //-коментарів до ///|//! — джерело дослівної доки doc-files

## [0.7.1] - 2026-07-22

### Fixed

- `rust/workspace_root` і `rust/applies`: обхід дерева тепер пропускає `.worktrees/` (спільний `RUST_WALK_IGNORED_DIR_NAMES`) — без цього auto-created worktree копії Cargo-маніфестів давали хибні `nested-workspace` violations; `rust/check`: коли `cargo-deny` не встановлено, `deny-config-missing` закривається детермінованим мінімальним `deny.toml` замість no-op → LLM-fix, який раніше галюцинував невалідну секцію `[deny]`

## [0.7.0] - 2026-07-21

### Added

- rust/workspace_root: канон одного кореневого Cargo workspace

## [0.6.1] - 2026-07-20

### Fixed

- cargo_mutants_config: T0-fix pattern id (test-cargo-mutants-config-create → rust-cargo-mutants-config-create) і JSDoc/доки узгоджені з поточним власником (правило rust, не test) — хвіст після переїзду концерну з ядра

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
