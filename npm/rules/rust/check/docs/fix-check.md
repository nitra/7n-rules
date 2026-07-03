---
type: JS Module
title: fix-check.mjs
resource: npm/rules/rust/check/fix-check.mjs
docgen:
  crc: 9367d7bd
---

## Огляд

T0-autofix для `rust/check`: детермінований `cargo fmt --all` (детектор ганяє його лише з
`--check`). Форматує Rust-код перед LLM-ладдером. clippy не автофіксимо (його `--fix`
потенційно небезпечний). Запис незворотний. Відсутній `cargo` → no-op.

## Поведінка

- Перелічує tracked \*.rs через git, застосовує `cargo fmt --all`.
- До списку змінених — лише файли з фактичною зміною.

## Публічний API

- `patterns` — `rust-cargo-fmt` спрацьовує на reason `cargo-fmt-violation`.

## Гарантії поведінки

- Записуються лише фактично змінені файли; кожен реєструється через `recordWrite`.
