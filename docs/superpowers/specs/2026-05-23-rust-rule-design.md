---
type: spec
title: "правило rust для @nitra/cursor"
---

# Нове правило `rust` (lint-rust) — design

**Дата:** 2026-05-23
**Автор:** brainstorm-сесія (vitaliytv ↔ Claude)
**Статус:** draft, очікує review перед `writing-plans`

## Мотивація

У монорепо з'являються пакети з Rust-кодом (Tauri-проєкти, окремі CLI-крейти). Зараз правила `@nitra/cursor` покривають лише JS/CSS/Vue, тож Rust-частина залишається без канонічного `lint-rust`-скрипта, CI workflow і VSCode-рекомендацій. Це призводить до дрейфу: кожен крейт ставить свій набір rustfmt/clippy-налаштувань, CI у різних репо відрізняється toolchain-actions, IDE-рекомендації для Rust-розробки відсутні.

Додатково: правило `tauri` зараз вимагає `rust-lang.rust-analyzer` у `.vscode/extensions.json`, що змішує два ortogonal-маркери (Tauri ≠ Rust). Після появи правила `rust` цю вимогу слід винести у нього, а `tauri` лишити вузько-Tauri-специфічним.

## Прийняті рішення (підсумок brainstorm)

| # | Рішення |
|---|---|
| R1 | Ідентифікатор — `rust` (паритет з `vue`, `tauri`, `capacitor`). Не `rust-lint` / `lint-rust`. |
| R2 | Auto-trigger — наявність `Cargo.toml` у корені або в будь-якому workspace-пакеті. |
| R3 | Скрипт-host — `scripts.lint-rust` у root `package.json`. Чисто Rust-проєкти без `package.json` поза скоупом цієї ітерації. |
| R4 | Канонічна команда — `cargo fmt --all && cargo clippy --fix --allow-staged --allow-dirty --all-targets --all-features && cargo clippy --all-targets --all-features -- -D warnings`. Локально з `--fix`, у CI без. |
| R5 | Без канонічних `rustfmt.toml` / `clippy.toml` — defaults + `-D warnings` достатньо для baseline. |
| R6 | CI — окремий `.github/workflows/lint-rust.yml` із канонічним вмістом (rego policy `policy/lint_rust_yml/`). |
| R7 | Toolchain у CI — `dtolnay/rust-toolchain@stable` (community standard) + `Swatinem/rust-cache@v2` для кешу target/registry. Без власного composite-action. |
| R8 | VSCode-extensions — `rust-lang.rust-analyzer` + `tamasfe.even-better-toml`. |
| R9 | Архітектура — rego-heavy (як `js-lint`/`style-lint`): три policy-пакети + `js/tooling/check.mjs` як FS-existence + `runConftestBatch`-orchestrator. |
| R10 | Refactor `tauri`: винести вимогу `rust-lang.rust-analyzer` у `rust`, лишити у `tauri` лише `tauri-apps.tauri-vscode`. |

## Архітектура

### Структура каталогу

```
npm/rules/rust/
├── rust.mdc                          — людиночитна спека
├── auto.md                           — "якщо в проекті є хоч один Cargo.toml"
├── fix.mjs                           — entry-point (делегує до runStandardRule)
├── js/
│   ├── applies/
│   │   └── check.mjs                 — applies(): Cargo.toml у cwd або workspace
│   └── tooling/
│       └── check.mjs                 — JS-orchestrator: FS-existence + runConftestBatch
└── policy/
    ├── package_json/
    │   ├── target.json
    │   ├── package_json.rego
    │   ├── package_json_test.rego
    │   └── template/package.json.snippet.json
    ├── vscode_extensions/
    │   ├── target.json
    │   ├── vscode_extensions.rego
    │   ├── vscode_extensions_test.rego
    │   └── template/extensions.json.snippet.json
    └── lint_rust_yml/
        ├── target.json
        ├── lint_rust_yml.rego
        ├── lint_rust_yml_test.rego
        └── template/lint-rust.yml.snippet.yml
```

Convention за технологією: `js/` (JS-implemented concerns) ↔ `policy/` (Rego-implemented). Узгоджено з [per-rule-fix-mjs-entry-point-design.md](2026-05-23-per-rule-fix-mjs-entry-point-design.md).

### Канонічні файли (предмет перевірки)

#### `package.json` (root)

```json
{
  "scripts": {
    "lint-rust": "cargo fmt --all && cargo clippy --fix --allow-staged --allow-dirty --all-targets --all-features && cargo clippy --all-targets --all-features -- -D warnings"
  }
}
```

Rego `rust.package_json` перевіряє substring для `scripts["lint-rust"]`: має містити **усі** три кроки — `cargo fmt`, `cargo clippy --fix`, фінальний `cargo clippy ... -- -D warnings`. Точна форма (порядок, прапори) — як у каноні. `devDependencies` нічого не додає (Rust toolchain ставиться поза npm).

#### `.vscode/extensions.json`

```json
{
  "recommendations": [
    "rust-lang.rust-analyzer",
    "tamasfe.even-better-toml"
  ]
}
```

Rego `rust.vscode_extensions` — `contains` для обох записів, не вимагає рівності множини (інші екстеншени дозволені).

#### `.github/workflows/lint-rust.yml`

```yaml
name: Lint Rust

on:
  push:
    branches:
      - dev
      - main
    paths:
      - '**/*.rs'
      - '**/Cargo.toml'
      - '**/Cargo.lock'
      - '**/rustfmt.toml'
      - '**/clippy.toml'

  pull_request:
    branches:
      - dev
      - main

concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - uses: Swatinem/rust-cache@v2

      - name: Rustfmt
        run: cargo fmt --all -- --check

      - name: Clippy
        run: cargo clippy --all-targets --all-features -- -D warnings
```

Rego `rust.lint_rust_yml` перевіряє інваріанти:
- `name == "Lint Rust"`,
- `concurrency.cancel-in-progress == true`,
- `jobs.lint.steps` містить у послідовності: `actions/checkout@v6` → `dtolnay/rust-toolchain@stable` з `components` що включає `rustfmt` і `clippy` → `Swatinem/rust-cache@v2` → step з `cargo fmt ... --check` → step з `cargo clippy ... -D warnings`.

CI **без `--fix`** (на відміну від локального `lint-rust`): fmt у `--check`, clippy без `--fix`.

#### `auto.md`

```
якщо в проекті є хоч один Cargo.toml
```

Стиль узгоджений з `capacitor/auto.md`.

### `js/applies/check.mjs`

```js
import { existsSync } from 'node:fs'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

export async function applies(ctx) {
  if (existsSync('Cargo.toml')) return true
  return hasCargoTomlInWorkspaces(ctx?.walkCache)
}

export function check() {
  const reporter = createCheckReporter()
  reporter.pass('Знайдено Cargo.toml — застосовуємо правила rust.mdc')
  return reporter.getExitCode()
}
```

Точне ім'я walker-утиліти (`hasCargoTomlInWorkspaces` / еквівалент) визначається при реалізації — за патерном існуючих walker'ів у `npm/scripts/utils/` (з `walkCache`).

### `js/tooling/check.mjs` (orchestrator)

Виключно FS-existence + делегування до rego через `runConftestBatch` (точний патерн з `tauri/js/tooling/check.mjs`):

```js
const docs = [
  { path: 'package.json',                    policyDir: 'rust/package_json',      ns: 'rust.package_json' },
  { path: '.vscode/extensions.json',         policyDir: 'rust/vscode_extensions', ns: 'rust.vscode_extensions' },
  { path: '.github/workflows/lint-rust.yml', policyDir: 'rust/lint_rust_yml',     ns: 'rust.lint_rust_yml' }
]
for (const d of docs) {
  if (!existsSync(d.path)) {
    reporter.fail(`${d.path} не існує — створи з канонічним вмістом (rust.mdc)`)
    continue
  }
  const violations = runConftestBatch({ policyDirRel: d.policyDir, namespace: d.ns, files: [d.path] })
  if (violations.length === 0) reporter.pass(`${d.path} відповідає ${d.ns} (rego)`)
  else for (const v of violations) reporter.fail(v.message)
}
```

### Rego policies — контракти

| Policy | `deny` фіксує |
|---|---|
| `rust.package_json` | `scripts["lint-rust"]` не містить `cargo fmt`, `cargo clippy --fix`, фінальний `cargo clippy ... -D warnings` (по одному `deny` на пропуск) |
| `rust.vscode_extensions` | `recommendations` не містить `rust-lang.rust-analyzer` або `tamasfe.even-better-toml` |
| `rust.lint_rust_yml` | `name != "Lint Rust"`; відсутня `concurrency.cancel-in-progress`; відсутній або порушений порядок steps (checkout → rust-toolchain з components → rust-cache → fmt --check → clippy -D warnings) |

Кожен `.rego` має `_test.rego` з 3–5 кейсами: golden pass + по одному per-vimoga fail.

### `template/*` (snippet-фрагменти)

Кожен policy має `template/<basename>.snippet.*` — мінімальний фрагмент канону, до якого `.mdc` посилається через `inlineTemplateLinks` (як у js-lint/style-lint). Snippet — джерело правди для прикладів у `n-rust.mdc`, що формується CLI.

## Інтеграція з пакетом

### `npm/scripts/auto-rules.mjs`

1. У `AUTO_RULE_ORDER` додати `'rust'` (алфавітне місце — між `rego` і `security`).
2. У `gatherProjectFacts` (або однойменну функцію) — новий fact `hasCargoToml`: `existsSync('Cargo.toml')` ∨ FS-walk workspaces.
3. У `autoRuleChecks`: `{ enabled: facts.hasCargoToml, id: 'rust' }`.

### `npm/scripts/tests/auto-rules.test.mjs`

- розширити expected `AUTO_RULE_ORDER` (додати `'rust'`);
- новий fixture-сценарій з `Cargo.toml` → правило детектиться;
- негативний сценарій (без Cargo.toml) → правило відсутнє.

### `CLAUDE.md` (root `nitra/cursor`)

`/Users/vitaliytv/www/nitra/cursor/CLAUDE.md` — додати рядок `@.cursor/rules/n-rust.mdc` у алфавітному порядку (між `n-rego.mdc` і `n-security.mdc`).

### `.cursor/rules/n-rust.mdc`

Синхронізується CLI з `npm/rules/rust/rust.mdc` при `npx @nitra/cursor` (стандартний механізм). Не пишемо вручну.

## Refactor `tauri.mdc` (узгоджений у секції 2 brainstorm)

Зміни в `npm/rules/tauri/`:

1. **`policy/vscode_extensions/vscode_extensions.rego`**: `required_extensions := {"tauri-apps.tauri-vscode"}` (видаляємо `rust-lang.rust-analyzer`).
2. **`policy/vscode_extensions/vscode_extensions_test.rego`**: оновити кейси — видалити сценарій з missing `rust-analyzer`, лишити missing `tauri-vscode`.
3. **`tauri.mdc`**: оновити приклад `.vscode/extensions.json` (лишити лише `tauri-apps.tauri-vscode`); додати речення: «`rust-lang.rust-analyzer` і `tamasfe.even-better-toml` вимагаються правилом `rust` (`n-rust.mdc`), бо Tauri-проєкт завжди має `src-tauri/Cargo.toml`.»
4. **applies-логіка `tauri`** — без змін (`src-tauri/`, `tauri.conf.json`, `@tauri-apps/*`). Це окремий маркер, не зводиться до Cargo.toml.

### Чому композиція без дублювання

Tauri-проєкт автоматично активує обидва правила:
- `rust` (Cargo.toml у `src-tauri/`) → `rust-analyzer`, `even-better-toml`, lint-rust, CI.
- `tauri` (src-tauri/ маркер) → `tauri-vscode`.

Обидва правила перевіряють `.vscode/extensions.json` за `contains`-семантикою — конкурентного запису немає, кожне додає свою підмножину `recommendations`.

## Non-goals

- Канонічні `rustfmt.toml` / `clippy.toml` із зафіксованим набором правил — лишаємо на майбутню ітерацію (з відстеженням реального дрейфу).
- `cargo deny` / supply-chain аудит — окреме правило `rust-deny` (поза скоупом).
- MSRV pinning (`rust-toolchain.toml`) — окреме рішення.
- Підтримка чисто Rust-проєктів без `package.json` — поза скоупом цієї ітерації (зараз у нашому контексті Rust завжди у Tauri- або гібридних монорепо з package.json).
- `cargo test` у CI — лінт-правило не охоплює тестування.

## CHANGELOG / version bump

Зміна додає нове правило + рефакторить `tauri.mdc` → minor bump `@nitra/cursor`. Запис у CHANGELOG:
- **Added:** правило `rust` (lint-rust): rustfmt + clippy, канонічний `lint-rust` скрипт, CI workflow `lint-rust.yml`, VSCode extensions `rust-analyzer` + `even-better-toml`.
- **Changed:** правило `tauri` звужено — `rust-lang.rust-analyzer` перенесено у нове правило `rust`.

## Послідовність реалізації (для writing-plans)

1. Створити скелет `npm/rules/rust/` (директорії, `fix.mjs`, `auto.md`, `rust.mdc`).
2. Створити три rego policy-пакети з `target.json`, `*.rego`, `*_test.rego`, `template/`.
3. Реалізувати `js/applies/check.mjs` (Cargo.toml gating).
4. Реалізувати `js/tooling/check.mjs` (orchestrator).
5. Інтегрувати у `auto-rules.mjs` (+ тести).
6. Рефакторити `tauri/policy/vscode_extensions/*` (звузити required_extensions).
7. Оновити `tauri.mdc` (приклад + посилання на rust).
8. Додати `@.cursor/rules/n-rust.mdc` у `CLAUDE.md`.
9. Записати CHANGELOG, bump версії `@nitra/cursor`.
10. Прогнати `npx @nitra/cursor check` + cursor self-check.
