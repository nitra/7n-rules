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
| R11 | Канон — лише у `template/<target>.<slot>.<ext>` ([scripts.mdc](../../.cursor/rules/scripts.mdc)). У `rust.mdc` — markdown-link на template (НЕ inline fenced-block з `title="<filename>"`). У `.rego` — читання `data.template.*`, без inline-літералів; drift-test у `_test.rego`. |
| R12 | Слоти: `package.json.contains.json` (substring-вимога scripts.lint-rust), `extensions.json.snippet.json` (subset-of для recommendations), `lint-rust.yml.snippet.yml` (повний файл як єдиний канон). |
| R13 | `withLock` делегується через `runStandardRule` ([scripts.mdc § withLock](../../.cursor/rules/scripts.mdc)) — у `fix.mjs` НЕ дублюємо. |

## Архітектура

### Структура каталогу

```
npm/rules/rust/
├── rust.mdc                          — людиночитна спека (markdown-links на template, без inline-fenced з title)
├── auto.md                           — "якщо в проекті є хоч один Cargo.toml"
├── fix.mjs                           — entry-point (делегує до runStandardRule; withLock — там, не тут)
├── js/
│   ├── applies/
│   │   ├── check.mjs                 — applies(): Cargo.toml у cwd або workspace
│   │   └── check.test.mjs            — bun-тести поруч з джерелом
│   └── tooling/
│       ├── check.mjs                 — JS-orchestrator: FS-existence + runConftestBatch
│       └── check.test.mjs
└── policy/
    ├── package_json/
    │   ├── target.json               — {"files":{"single":"package.json","required":true},"missingMessage":"…"}
    │   ├── package_json.rego         — `package rust.package_json` + `import rego.v1`; читає `data.template.contains.package_json`
    │   ├── package_json_test.rego    — golden pass + per-substring fail + drift-test (підміна data.template → нова deny)
    │   └── template/
    │       └── package.json.contains.json    — масив підрядків для scripts.lint-rust
    ├── vscode_extensions/
    │   ├── target.json               — {"files":{"single":".vscode/extensions.json","required":true},"missingMessage":"…"}
    │   ├── vscode_extensions.rego    — читає `data.template.snippet.extensions_json.recommendations` як subset-of
    │   ├── vscode_extensions_test.rego
    │   └── template/
    │       └── extensions.json.snippet.json  — {"recommendations":["rust-lang.rust-analyzer","tamasfe.even-better-toml"]}
    └── lint_rust_yml/
        ├── target.json               — {"files":{"single":".github/workflows/lint-rust.yml","required":true},"missingMessage":"…"}
        ├── lint_rust_yml.rego        — читає `data.template.snippet.lint_rust_yml` (повний файл як єдиний канон); інваріанти беруться з template
        ├── lint_rust_yml_test.rego
        └── template/
            └── lint-rust.yml.snippet.yml     — повний канонічний workflow
```

Convention за технологією: `js/` (JS-implemented concerns) ↔ `policy/` (Rego-implemented). Узгоджено з [per-rule-fix-mjs-entry-point-design.md](2026-05-23-per-rule-fix-mjs-entry-point-design.md).

### Канонічні файли (предмет перевірки)

Усі три канонічні форми **живуть у `template/`** ([scripts.mdc § Канон через template](../../.cursor/rules/scripts.mdc)). У `rust.mdc` — лише markdown-link на template; жодного inline-fenced-блоку з `title="<filename>"`. У `.rego` — лише `data.template.*`, жодного inline-літералу. Тут у спеці наводимо вміст для огляду; реальне джерело істини — `template/`.

#### `npm/rules/rust/policy/package_json/template/package.json.contains.json`

Слот **`.contains.json`** — масив підрядків, кожен з яких має бути присутнім у відповідному leaf (`scripts["lint-rust"]`):

```json
{
  "scripts": {
    "lint-rust": [
      "cargo fmt --all",
      "cargo clippy --fix --allow-staged --allow-dirty",
      "cargo clippy --all-targets --all-features -- -D warnings"
    ]
  }
}
```

`rust.package_json.rego` емітить один `deny contains msg` на кожен пропущений підрядок. Канонічна повна форма скрипта (для документації / `n-cursor fix`-репортів) — `cargo fmt --all && cargo clippy --fix --allow-staged --allow-dirty --all-targets --all-features && cargo clippy --all-targets --all-features -- -D warnings`.

#### `npm/rules/rust/policy/vscode_extensions/template/extensions.json.snippet.json`

Слот **`.snippet.json`** — subset-of для масивів (інші екстеншени дозволені):

```json
{
  "recommendations": [
    "rust-lang.rust-analyzer",
    "tamasfe.even-better-toml"
  ]
}
```

`rust.vscode_extensions.rego` емітить `deny` для кожного запису з `data.template.snippet.extensions_json.recommendations`, якого немає у `recommendations` цільового файлу.

#### `npm/rules/rust/policy/lint_rust_yml/template/lint-rust.yml.snippet.yml`

Слот **`.snippet.yml`** — повний канонічний workflow (єдине джерело істини для CI):

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

`rust.lint_rust_yml.rego` рахує інваріанти **на льоту з `data.template.snippet.lint_rust_yml`** (drift-safe): `name`, `concurrency.cancel-in-progress`, послідовність `jobs.lint.steps` (uses + run-blob як `concat` з template) — щоб зміна template автоматично рухала перевірку. CI **без `--fix`** (fmt у `--check`, clippy без `--fix`).

#### `target.json` формат (для всіх трьох концернів)

За [scripts.mdc](../../.cursor/rules/scripts.mdc):

```json
{
  "files": { "single": "<шлях>", "required": true },
  "missingMessage": "<людиночитне повідомлення з посиланням на rust.mdc>"
}
```

- `package_json/target.json`: `"single": "package.json"`
- `vscode_extensions/target.json`: `"single": ".vscode/extensions.json"`
- `lint_rust_yml/target.json`: `"single": ".github/workflows/lint-rust.yml"`

#### `auto.md`

```
якщо в проекті є хоч один Cargo.toml
```

Стиль узгоджений з `capacitor/auto.md`.

### `fix.mjs` (entry-point)

Канонічна форма 8-рядкового entry-point ([per-rule-fix-mjs-entry-point-design.md](2026-05-23-per-rule-fix-mjs-entry-point-design.md)). Делегує до `runStandardRule`; `withLock` живе там — у `fix.mjs` НЕ дублюємо ([scripts.mdc § withLock](../../.cursor/rules/scripts.mdc)). Перед `import` — багаторядковий JSDoc українською (вимога scripts.mdc).

### `js/applies/check.mjs`

```js
/**
 * Applies-гейт правила rust: маркер — наявність `Cargo.toml` у `cwd` або
 * в будь-якому workspace-пакеті. Якщо повертає `false` — CLI пропускає всі
 * концерни (JS і policy) цього правила. `check()` друкує тільки context-pass.
 */
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

Точне ім'я walker-утиліти (`hasCargoTomlInWorkspaces` / еквівалент) визначається при реалізації — за патерном існуючих walker'ів у `npm/scripts/utils/` (з `walkCache`). Якщо такого helper'а ще немає — вводимо у спільні `utils/` (не локально у правилі), бо логіка «знайти файл по workspaces» — крос-правильна.

### `js/tooling/check.mjs` (orchestrator)

Виключно FS-existence + делегування до rego через `runConftestBatch` (точний патерн з `tauri/js/tooling/check.mjs`). FS-існування target-файлів технічно дублюється з `target.json`'s `"required": true` + `missingMessage` — але `tooling/check.mjs` дає краще UX-повідомлення з посиланням на `rust.mdc`, тому залишаємо явну перевірку (як у `tauri`). Перед `import` — багаторядковий JSDoc українською.

```js
/**
 * Перевіряє Rust-інструментарій (rust.mdc): FS-існування трьох канонічних
 * документів + делегування content-перевірок у rego через runConftestBatch.
 * Cross-file gating (applies) винесено у `js/applies/check.mjs`.
 */
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

Кожен `.rego` має `package rust.<concern>` + `import rego.v1`. Канонічні літерали — **виключно** через `data.template.*` (рунер передає через `--data`), без inline-рядків ([scripts.mdc § Канон через template](../../.cursor/rules/scripts.mdc)).

| Policy | Слот | `deny` логіка |
|---|---|---|
| `rust.package_json` | `data.template.contains.package_json.scripts["lint-rust"]` (масив підрядків) | для кожного `s` із масиву: якщо `contains(input.scripts["lint-rust"], s) == false` → `deny` |
| `rust.vscode_extensions` | `data.template.snippet.extensions_json.recommendations` (subset-of) | для кожного `ext` із template: якщо `ext` не в `input.recommendations` → `deny` |
| `rust.lint_rust_yml` | `data.template.snippet.lint_rust_yml` (повний YAML) | `input.name == template.name`; `input.concurrency["cancel-in-progress"] == template.concurrency["cancel-in-progress"]`; для кожного step з `template.jobs.lint.steps` (uses або run) — присутній у `input.jobs.lint.steps` у тому ж порядку. Run-blob беремо через `concat` з `template.jobs.lint.steps[].run`, щоб зміна template автоматично рухала перевірку. |

Кожен `.rego` має `_test.rego` з 3–5 кейсами: golden pass + по одному per-vимога fail + **drift-test**: при підміні `data.template.*` правило emit-ить нову очікувану `deny` substring ([scripts.mdc § Drift-tests](../../.cursor/rules/scripts.mdc)). Drift-test гарантує, що template веде перевірку, а не задубльована inline-константа.

### Використання template у JS-orchestrator та `.mdc`

- **`js/tooling/check.mjs`**: FS-existence check + делегування у rego через `runConftestBatch` (rego сам читає `data.template.*` через `--data`). Для repotting `template/`-шляхів — `loadTemplate` / `resolveConcernTemplateData` з `npm/scripts/utils/template.mjs`, якщо знадобиться FS-only логіка (наразі не потрібно — усе делегується у rego).
- **`rust.mdc`**: для кожного target — markdown-link на template-файл, формат:
  > Канон `scripts.lint-rust` (substring requirement): [`package.json.contains.json`](./policy/package_json/template/package.json.contains.json)
  >
  > Канон `.vscode/extensions.json` recommendations: [`extensions.json.snippet.json`](./policy/vscode_extensions/template/extensions.json.snippet.json)
  >
  > Канон CI workflow `.github/workflows/lint-rust.yml`: [`lint-rust.yml.snippet.yml`](./policy/lint_rust_yml/template/lint-rust.yml.snippet.yml)

  `inlineTemplateLinks` під час `npx @nitra/cursor` sync підставить вміст у `.cursor/rules/n-rust.mdc` як fenced-блок з мітками native-формату. **Не** додавати inline fenced-block з `title="<filename>"` поруч з лінком — це другий source of truth (red flag за scripts.mdc).

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

За [scripts.mdc § Завершення задачі](../../.cursor/rules/scripts.mdc) + [n-changelog.mdc](../../.cursor/rules/n-changelog.mdc): останніми кроками сесії (після тестів / sync, **перед** фінальною відповіддю користувачу) — bump `version` у `npm/package.json` → нова секція у `npm/CHANGELOG.md` → `npx @nitra/cursor fix changelog`.

Зміна додає нове правило + рефакторить `tauri.mdc` → minor bump `@nitra/cursor`. Запис у CHANGELOG:
- **Added:** правило `rust` (lint-rust): rustfmt + clippy, канонічний `lint-rust` скрипт, CI workflow `lint-rust.yml`, VSCode extensions `rust-analyzer` + `even-better-toml`.
- **Changed:** правило `tauri` звужено — `rust-lang.rust-analyzer` перенесено у нове правило `rust`.

## Послідовність реалізації (для writing-plans)

1. **Скелет правила:** створити `npm/rules/rust/{rust.mdc, auto.md, fix.mjs}` (fix.mjs — 8-рядковий entry-point, делегує до `runStandardRule`, без власного `withLock`).
2. **`policy/<concern>/`** для кожного з трьох (`package_json`, `vscode_extensions`, `lint_rust_yml`):
   - `target.json` за форматом `{"files":{"single":"...","required":true},"missingMessage":"..."}`,
   - `template/<basename>.<slot>.<ext>` як єдиний source-of-truth (`.contains.json` для package_json, `.snippet.*` для двох інших),
   - `<concern>.rego` (`package rust.<concern>` + `import rego.v1`, читає `data.template.*` через `--data`, без inline-літералів),
   - `<concern>_test.rego` (golden pass + per-vимога fail + **drift-test** з підміною `data.template.*`).
3. **`js/applies/check.mjs`** + `check.test.mjs` (Cargo.toml gating; якщо потрібен новий walker — додати у `npm/scripts/utils/`).
4. **`js/tooling/check.mjs`** + `check.test.mjs` (FS-existence + `runConftestBatch` orchestrator, точний патерн з `tauri/js/tooling/check.mjs`).
5. **`rust.mdc`**: лише markdown-links на `template/*` файли; жодного inline-fenced-блока з `title="<filename>"`. JSDoc / human-text українською.
6. **`auto-rules.mjs`** інтеграція: `AUTO_RULE_ORDER` (між `rego` і `security`), fact `hasCargoToml`, `autoRuleChecks` запис + розширення тестів у `npm/scripts/tests/auto-rules.test.mjs`.
7. **Refactor `tauri`**: звузити `policy/vscode_extensions/vscode_extensions.rego` (required_extensions = `tauri-vscode`), оновити `_test.rego`, оновити `tauri.mdc` (приклад + посилання на rust).
8. **`CLAUDE.md`** (`/Users/vitaliytv/www/nitra/cursor/CLAUDE.md`): додати `@.cursor/rules/n-rust.mdc` (між `n-rego.mdc` і `n-security.mdc`).
9. **Тести**: `bun test` у `npm/`; `bun run lint-rego` (regal + `conftest verify` для `_test.rego`).
10. **Verification:** прогнати `npx @nitra/cursor fix` (за `n-fix`-скілом) на fixture-проєкті з Cargo.toml і без; самоперевірка `npx @nitra/cursor fix` у самому пакеті.
11. **Завершення задачі** (scripts.mdc § Завершення): bump `npm/package.json` version → секція у `npm/CHANGELOG.md` → `npx @nitra/cursor fix changelog` — у тому ж логічному кроці, до фінальної відповіді.
