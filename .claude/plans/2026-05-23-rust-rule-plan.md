---
type: plan
title: "правило rust для @nitra/cursor"
---

# Implementation Plan: правило `rust` для @nitra/cursor

Reference spec: `docs/superpowers/specs/2026-05-23-rust-rule-design.md`

## Overview

Додати нове правило `rust` до пакету `@nitra/cursor`, яке перевіряє Rust-проєкти (маркер — `Cargo.toml`). Правило складається з трьох rego-policy-пакетів (`package_json`, `vscode_extensions`, `lint_rust_yml`), JS-check із gating, cursor-rule та реєстрації в `auto-rules.mjs`.

---

## Tasks

### 1. Створити `npm/rules/rust/rust.mdc`
- Files: `npm/rules/rust/rust.mdc`
- What to do: Human-readable spec правила. Globs: `**/*.rs,**/Cargo.toml,**/Cargo.lock`. Описати lint-rust скрипт, VSCode extensions, CI workflow.

### 2. Створити `npm/rules/rust/auto.md`
- Files: `npm/rules/rust/auto.md`
- What to do: Вміст: `якщо в проєкті є файл Cargo.toml`

### 3. Створити `npm/rules/rust/fix/tooling/check.mjs`
- Files: `npm/rules/rust/fix/tooling/check.mjs`
- What to do: JS-check з gating (Cargo.toml) + runConftestBatch. Зразок: style-lint/fix/tooling/check.mjs.

### 4. Створити `policy/package_json`
- Files: `npm/rules/rust/policy/package_json/{package_json.rego,package_json_test.rego,target.json,template/package.json}`
- What to do: target=package.json, violation якщо scripts["lint-rust"] не містить "cargo", тест + template з canonical cmd.

### 5. Створити `policy/vscode_extensions`
- Files: `npm/rules/rust/policy/vscode_extensions/{vscode_extensions.rego,vscode_extensions_test.rego,target.json}`
- What to do: target=.vscode/extensions.json, два violations (rust-lang.rust-analyzer, tamasfe.even-better-toml), тести.

### 6. Створити `policy/lint_rust_yml`
- Files: `npm/rules/rust/policy/lint_rust_yml/{lint_rust_yml.rego,lint_rust_yml_test.rego,target.json,template/lint-rust.yml}`
- What to do: target=.github/workflows/lint-rust.yml, перевіряти oven-sh/setup-bun@v2 + dtolnay/rust-toolchain@stable + bun run lint-rust.

### 7. Створити `.cursor/rules/n-rust.mdc`
- Files: `.cursor/rules/n-rust.mdc`
- What to do: Копія npm/rules/rust/rust.mdc. Зразок: .cursor/rules/n-js-lint.mdc.

### 8. Зареєструвати в `npm/scripts/auto-rules.mjs`
- Files: `npm/scripts/auto-rules.mjs`
- What to do: Додати 'rust' у AUTO_RULE_ORDER (після 'rego') + { enabled: facts.hasCargoToml, id: 'rust' } у enabledRules. hasCargoToml вже є у walk (рядки 300, 308).

### 9. CHANGELOG + version bump
- Files: `npm/CHANGELOG.md`, `npm/package.json`
- What to do: Додати запис про нове правило rust, minor version bump.

---

## Validation

- [ ] `ls npm/rules/rust/` — всі файли присутні
- [ ] `npx @nitra/cursor check` — без помилок по rust
- [ ] `cd npm && bun test` — rego-тести для rust проходять
- [ ] `grep 'rust' npm/scripts/auto-rules.mjs` — правило зареєстровано
- [ ] `cat npm/CHANGELOG.md` — запис про rust присутній
