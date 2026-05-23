---
session: cd601c3c-0f14-4351-9c41-ac2e633456c0
captured: 2026-05-23T22:28:50+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/cd601c3c-0f14-4351-9c41-ac2e633456c0.jsonl
---

## ADR Новий npm-пакет правила `rust` (rustfmt + clippy, rego-heavy)

## Context and Problem Statement
Проєкти з Rust-кодом (Tauri-додатки, автономні утиліти, workspace-крейти) не мали автоматичної перевірки форматування та lint-якості. Потрібне нове правило `rust` у пакеті `@nitra/cursor`, яке забезпечить канонічний скрипт `lint-rust`, VSCode-розширення та CI workflow.

## Considered Options
* **A. Rego-heavy** — три окремих rego-policy-пакети (`package_json`, `vscode_extensions`, `lint_rust_yml`), JS-orchestrator в `js/tooling/check.mjs`, за зразком `js-lint`/`style-lint`.
* **B. JS-heavy** — лише один rego-пакет `vscode_extensions`; `package.json` і workflow перевіряються JS-логікою.
* **C. Гібрид** — rego для `package_json` і `vscode_extensions`, workflow — JS.

## Decision Outcome
Chosen option: "A. Rego-heavy (за зразком js-lint/style-lint)", because дрейф від встановленої конвенції (три rego-пакети) створить технічний борг при додаванні майбутніх перевірок (наприклад, `cargo deny`, MSRV); паритет з `js-lint`/`style-lint` полегшує обслуговування.

### Consequences
* Good, because transcript фіксує очікувану користь: структура нового правила повністю відповідає паттерну `style-lint`, всі три документи перевіряються окремими rego-пакетами з тестами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Дизайн-спека: `docs/superpowers/specs/2026-05-23-rust-rule-design.md` (committed у `2730c02`)
- План реалізації: `.claude/plans/rust-rule.md`
- Структура: `npm/rules/rust/{rust.mdc,auto.md,fix.mjs,js/applies/check.mjs,js/tooling/check.mjs,policy/package_json/,policy/vscode_extensions/,policy/lint_rust_yml/}`
- Реєстрація: `npm/scripts/auto-rules.mjs` — `hasCargoToml = exists(path.join(cwd,'Cargo.toml'))`, запис у `AUTO_RULE_ORDER` та `autoRuleChecks`
- Gating: `existsSync(path.join(cwd,'Cargo.toml'))` у `js/applies/check.mjs`
- Скрипт: `scripts["lint-rust"]` = `cargo fmt --all && cargo clippy --all-targets --all-features --fix --allow-dirty -- -D warnings`
- CI: `dtolnay/rust-toolchain@stable` з `components: rustfmt,clippy`; rego перевіряє substring `dtolnay/rust-toolchain@stable` у `uses` та `cargo clippy` + `-D warnings` у `run`; `fmt --check` у CI не вимагається
- VSCode: `rust-lang.rust-analyzer` + `tamasfe.even-better-toml`
- Супутнє рішення: `tauri/policy/vscode_extensions` звужується до `tauri-apps.tauri-vscode` — `rust-lang.rust-analyzer` переноситься у `rust`

---

## ADR Композиція правил `rust` і `tauri` — розподіл відповідальності VSCode-розширень

## Context and Problem Statement
Правило `tauri` містило `rust-lang.rust-analyzer` у своєму `vscode_extensions.rego`. З появою правила `rust`, яке є ширшим (Rust без Tauri), виникло дублювання вимоги для Tauri-проєктів.

## Considered Options
* Перенести `rust-lang.rust-analyzer` у `rust`, звузити `tauri` до Tauri-специфічних розширень.
* Залишити `rust-lang.rust-analyzer` у `tauri`, не додавати у `rust` (дублювання для Tauri-проєктів).

## Decision Outcome
Chosen option: "Перенести `rust-lang.rust-analyzer` у `rust`, звузити `tauri`", because `rust-lang.rust-analyzer` є Rust-специфічним, а не Tauri-специфічним; `tauri` залишає лише `tauri-apps.tauri-vscode`; обидва правила auto-активуються незалежно (Tauri-проєкт має `Cargo.toml` → отримує `rust` автоматично через `hasCargoToml`).

### Consequences
* Good, because transcript фіксує очікувану користь: жодного дублювання у rego-перевірках; кожне правило перевіряє свою підмножину `recommendations` через `contains`, не `equals`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінювані файли tauri: `npm/rules/tauri/policy/vscode_extensions/vscode_extensions.rego`, `vscode_extensions_test.rego`, `npm/rules/tauri/tauri.mdc`
- `auto.md` файли залишаються незалежними — явний зв'язок між правилами не вводиться
- Додаткова інформація: Task 1 у `.claude/plans/rust-rule.md`
