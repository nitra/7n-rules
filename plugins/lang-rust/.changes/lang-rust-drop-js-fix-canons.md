---
bump: minor
section: Removed
---

Знято всі ЧОТИРИ JS-канони T0-фікса плагіна: `rules/rust/doc_comments/fix-doc_comments.mjs`, `rules/rust/check/fix-check.mjs`, `rules/rust/cargo_mutants_config/fix-cargo_mutants_config.mjs`, `rules/rust/vscode_extensions/fix-vscode_extensions.mjs`. Кожен із цих концернів має фікс у wasm-гості `crates/plugin-lang-rust`, і тепер гість — ЄДИНА реалізація, а не пріоритетна з JS-fallback-ом. Борг «спершу парність» на цьому плагіні закрито повністю.

Спостережувана поведінка `--fix` не змінилась: гість і доти мав пріоритет (`T0Pattern.guestFix`). Звірку порядково зроблено перед видаленням, і в жодному з чотирьох концернів канон не робив того, чого не робить гість. Розбіжності — на користь гостя й уже задокументовані хвилями порту: guard ідемпотентності в `doc_comments`, `include_str!`-вшитий baseline у `cargo_mutants_config` (шаблон не може «зникнути з пакета»), гучний `LogLevel::Error` там, де канон `rust/check` мовчки віддавав порожній результат (`cargo` не резолвиться; провалений `cargo fmt --all`).

Канони-ДЖЕРЕЛА лишились на місці й нікуди не діваються: `concern.json`, `vscode_extensions.rego`, `template/**` і обидва data-файли (`check/data/check/deny.toml.minimal`, `cargo_mutants_config/data/cargo_mutants_config/mutants.toml.baseline`) — гість вшиває їх `include_str!`-ом, тож detect-парність через справжній `conftest` і байт-у-байт звірка скаффолда `deny.toml` лишились живими.

Практичний наслідок, який варто знати: fallback-у більше немає. Якщо wasm-компонент `lang-rust` у консюмері не резолвиться (плагін не зібрано, розбіжність піна, хост без wasm), кожен із чотирьох концернів деградує з «автофікс» у «порушення показано, концерн пішов у LLM-ладдер» — раніше цей випадок гасив JS-канон.

Деталі, порядкова звірка й повний облік тестів — §2.91 `docs/plans/2026-08-05-open-questions-register.md`.
