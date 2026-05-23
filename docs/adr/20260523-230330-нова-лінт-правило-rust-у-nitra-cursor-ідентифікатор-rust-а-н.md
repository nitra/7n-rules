---
session: cd601c3c-0f14-4351-9c41-ac2e633456c0
captured: 2026-05-23T23:03:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/cd601c3c-0f14-4351-9c41-ac2e633456c0.jsonl
---

## ADR Нова лінт-правило `rust` у `@nitra/cursor`: ідентифікатор `rust`, а не `rust-lint`

## Context and Problem Statement
При додаванні нового правила для Rust-проєктів треба було визначити його ідентифікатор у `npm/rules/` і `.cursor/rules/`. Проєкт має два наявних прецеденти: правила, названі за технологією (`vue`, `tauri`, `capacitor`), і правила, названі за дією (`js-lint`, `style-lint`).

## Considered Options
* `rust-lint` — симетрично до `js-lint` і `style-lint`
* `rust` — симетрично до `vue`, `tauri`, `capacitor`

## Decision Outcome
Chosen option: "`rust`", because у transcript явно обрано парність з `vue`, `tauri`, `capacitor` (технологія, а не дія): папка `npm/rules/rust/`, файли `rust.mdc`, `.cursor/rules/n-rust.mdc`.

### Consequences
* Good, because transcript фіксує очікувану користь: ідентифікатор узгоджений з усіма технологічними правилами пакету без нових винятків.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/scripts/auto-rules.mjs` — `AUTO_RULE_ORDER` з наявним прикладом `'capacitor'`; `npm/rules/tauri/`, `npm/rules/vue/` — референсні директорії.

---

## ADR Rego-heavy архітектура нового правила `rust`

## Context and Problem Statement
Треба було вибрати, яка частина перевірочної логіки живе у Rego-policy, а яка — у JavaScript: три документи перевіряються (`package.json`, `.vscode/extensions.json`, `.github/workflows/lint-rust.yml`), і для них є два наявних архітектурних прецеденти.

## Considered Options
* Rego-heavy (як `js-lint`/`style-lint`) — три policy-пакети, JS-orchestrator лише для FS-existence і `runConftestBatch`
* JS-heavy (як `tauri`) — лише один policy-пакет `vscode_extensions`, решта перевіряється у JS
* Гібрид — rego для `package_json` і `vscode_extensions`, CI-workflow у JS

## Decision Outcome
Chosen option: "Rego-heavy (як `js-lint`/`style-lint`)", because у transcript зафіксовано: нове правило має ті самі три документи, що й `js-lint`/`style-lint`, тому дрейф від встановленої конвенції створив би технічний борг при майбутніх змінах перевірок.

### Consequences
* Good, because transcript фіксує очікувану користь: три policy-пакети (`package_json`, `vscode_extensions`, `lint_rust_yml`) з відповідними `target.json`, `_test.rego`, `template/` — консистентно з наявним каноном.
* Bad, because transcript не містить підтверджених негативних наслідків (більший boilerplate було названо мінусом, але вирішальним не визнано).

## More Information
`npm/rules/js-lint/policy/`, `npm/rules/style-lint/policy/` — референсні структури; `.cursor/rules/scripts.mdc v1.10` — канон template-slot'ів (`.contains.json`, `.snippet.*`), формату `target.json`, вимоги drift-test у `_test.rego`.

---

## ADR Автоматичний gating правила `rust` за наявністю `Cargo.toml`

## Context and Problem Statement
Правила `@nitra/cursor` активуються умовно залежно від ознак проєкту (`auto.md`). Потрібно було визначити маркер Rust-проєкту для нового правила.

## Considered Options
* `Cargo.toml` у корені або workspace (FS-маркер)
* Залежність `@rust-*` у `package.json` (npm-маркер)
* Завжди (не умовне правило)

## Decision Outcome
Chosen option: "`Cargo.toml` у корені або workspace", because у transcript явно обрано FS-маркер за аналогом `capacitor` (`capacitor.config.json`).

### Consequences
* Good, because transcript фіксує очікувану користь: `auto.md` стилістично узгоджений з `capacitor/auto.md`; `npm/scripts/auto-rules.mjs` отримує новий fact `hasCargoToml` + запис `{ enabled: facts.hasCargoToml, id: 'rust' }`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/rules/capacitor/auto.md` — референс стилю; `npm/scripts/auto-rules.mjs` — місце реєстрації fact і `autoRuleChecks`.

---

## ADR Канонічна команда `lint-rust` з кроком `--fix` перед перевіркою

## Context and Problem Statement
Треба було визначити, яку команду записувати у `scripts.lint-rust` у `package.json` і яку перевіряти через Rego: строгу (лише `--check`, ніяких fix), або з автофіксом на першому кроці.

## Considered Options
* Строга (тільки `--check`, без `--fix`) — `cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings`
* З автофіксом локально — `cargo fmt --all && cargo clippy --fix --allow-staged --allow-dirty --all-targets --all-features && cargo clippy --all-targets --all-features -- -D warnings`

## Decision Outcome
Chosen option: "з автофіксом локально", because у transcript обрано тристадійний підхід: `cargo fmt` (fix), `cargo clippy --fix` (fix), `cargo clippy -D warnings` (перевірка) — для зручності локального dev-режиму.

### Consequences
* Good, because transcript фіксує очікувану користь: `--allow-staged --allow-dirty` дають можливість запускати скрипт на брудному дереві у локальному dev.
* Bad, because transcript не містить підтверджених негативних наслідків; CI-workflow використовує окремий підхід — тільки `--check`/`-D warnings` без `--fix` (CI і локальний скрипт різняться навмисно).

## More Information
Rego-policy `rust.package_json.deny` перевіряє наявність підрядків `cargo fmt`, `cargo clippy --fix`, `cargo clippy` + `-D warnings` у значенні `scripts["lint-rust"]`.

---

## ADR Склад CI-workflow `lint-rust.yml`: `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2`

## Context and Problem Statement
Для CI-workflow потрібно було вибрати, як встановлювати Rust toolchain та чи кешувати залежності.

## Considered Options
* `dtolnay/rust-toolchain@stable` безпосередньо у `lint-rust.yml`
* `Swatinem/rust-cache@v2` — додати до workflow як третю action чи ні

## Decision Outcome
Chosen option: "`dtolnay/rust-toolchain@stable` з `components: rustfmt, clippy` + `Swatinem/rust-cache@v2`", because у transcript `dtolnay/rust-toolchain@stable` названо «офіційним maintained action, світовим стандартом»; `Swatinem/rust-cache@v2` додано тому, що `dtolnay/rust-toolchain` сам не кешує `target/registry` — без нього кожен CI-прогон витрачає зайві хвилини.

### Consequences
* Good, because transcript фіксує очікувану користь: кешування зберігає час на повторних запусках CI.
* Bad, because Neutral, because transcript не містить підтвердження наслідку (жодних даних про реальний приріст швидкості ще немає).

## More Information
Rego-policy `rust.lint_rust_yml.deny` перевіряє послідовність steps: `actions/checkout@v6` → `dtolnay/rust-toolchain@stable` (з `components` що містить `rustfmt` і `clippy`) → `Swatinem/rust-cache@v2` → step з `cargo fmt ... --check` → step з `cargo clippy ... -D warnings`. `lint_rust_yml.yml.snippet.yml` — канонічний template.

---

## ADR Виділення `rust-lang.rust-analyzer` з правила `tauri` у правило `rust`

## Context and Problem Statement
Правило `tauri` вимагало `rust-lang.rust-analyzer` у `.vscode/extensions.json`. З появою правила `rust` виникло дублювання: Tauri-проєкт завжди має `src-tauri/Cargo.toml`, тому обидва правила активні одночасно.

## Considered Options
* Залишити `rust-lang.rust-analyzer` у `tauri.policy.vscode_extensions` (дублювання)
* Перенести `rust-lang.rust-analyzer` і `tamasfe.even-better-toml` у `rust.policy.vscode_extensions`; `tauri` вимагає лише `tauri-apps.tauri-vscode`

## Decision Outcome
Chosen option: "перенести у `rust`, `tauri` вимагає лише `tauri-apps.tauri-vscode`", because у transcript явно узгоджено: для Tauri-проєкту обидва правила активні одночасно, rego перевіряє `contains` (не рівність множини), тому два правила доповнюють одне одного без конфліктів.

### Consequences
* Good, because transcript фіксує очікувану користь: єдине джерело вимоги `rust-lang.rust-analyzer` — правило `rust`; `tauri` звужується до справді Tauri-специфічного.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни: `npm/rules/tauri/policy/vscode_extensions/vscode_extensions.rego` → `required_extensions := {"tauri-apps.tauri-vscode"}`; `vscode_extensions_test.rego` — оновити fixtures; `npm/rules/tauri/tauri.mdc` — додати посилання на `rust.mdc` як джерело вимог `rust-lang.rust-analyzer`.
