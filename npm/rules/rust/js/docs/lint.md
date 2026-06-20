---
type: JS Module
title: lint.mjs
resource: npm/rules/rust/js/lint.mjs
docgen:
  crc: 5d7c4123
  score: 100
---

Оркестраторний адаптер правила `rust` для `n-cursor lint`: rustfmt + clippy через `cargo`. Запускається на `n-cursor lint rust`. За відсутності `Cargo.toml` у корені — no-op (вихід 0). `cargo`/`rustfmt`/`clippy` резолвляться з PATH (Rust toolchain через rustup), не з npm-залежностей; якщо `cargo` відсутній за наявного `Cargo.toml` — помилка.

## Поведінка

1. `readOnly` (CI): `cargo fmt --all -- --check` + `cargo clippy --all-targets --all-features -- -D warnings` — детект без мутацій.
2. fix-режим: `cargo fmt --all` + `cargo clippy --fix` + фінальний `cargo clippy … -D warnings`.
3. Перший ненульовий cargo-крок спиняє ланцюг і повертає його код.

## Гарантії поведінки

- Read-only за наявності `readOnly`: cargo не мутує робоче дерево (`--check`, без `--fix`).
- Не звертається до мережі напряму (cargo-кроки можуть тягнути crates, але це поведінка тулчейну).
