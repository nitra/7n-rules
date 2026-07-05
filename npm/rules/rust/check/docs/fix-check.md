---
type: JS Module
title: fix-check.mjs
resource: npm/rules/rust/check/fix-check.mjs
docgen:
  crc: 02793a78
---

## Огляд

T0-autofix для `rust/check`: детермінований `cargo fmt --all` (детектор ганяє його лише з
`--check`) і канонічна генерація `deny.toml` через `cargo deny init`. Форматує Rust-код перед
LLM-ладдером. clippy не автофіксимо (його `--fix` потенційно небезпечний) — ці порушення й
далі йдуть у LLM-ladder. Запис незворотний. Відсутній `cargo`/`cargo-deny` → no-op.

## Поведінка

- Перелічує tracked \*.rs через git, застосовує `cargo fmt --all`. До списку змінених — лише
  файли з фактичною зміною.
- За наявності порушення `deny-config-missing` і встановленого `cargo-deny` викликає
  `cargo deny init`, що створює канонічний `deny.toml` у корені проєкту.

## Публічний API

- `patterns` — `rust-cargo-fmt` спрацьовує на reason `cargo-fmt-violation`;
  `rust-cargo-deny-init` спрацьовує на reason `deny-config-missing`.

## Гарантії поведінки

- Записуються лише фактично змінені/створені файли; кожен реєструється через `recordWrite`.
