---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/tool_surface/main.mjs
docgen:
  crc: 87b28b8d
---

## Огляд

Детектор concern-а `tool_surface`: для кожного Tauri-workspace знаходить Tauri-плагіни,
яких торкається JS/TS/Vue-код (через `@tauri-apps/plugin-*` import або прямий
`invoke('plugin:<slug>|...')`), і для кожного такого плагіна перевіряє три незалежні умови —
(1) crate-залежність присутня в `src-tauri/Cargo.toml`, (2) rust-ідентифікатор
(`tauri_plugin_<slug>`) згаданий у `src-tauri/src/lib.rs` (зареєстрований у builder-і),
(3) permission для нього є в `src-tauri/capabilities/*.json`. Відсутність будь-якої з трьох —
тихий рантайм-фейл без помилки компіляції, тому кожна дає окрему violation
(`tool-surface-plugin-dep-missing` / `-not-registered` / `-capability-missing`).

## Публічний API

`PLUGIN_DEP_MISSING`, `PLUGIN_NOT_REGISTERED`, `PLUGIN_CAPABILITY_MISSING` — константи
причин violation. `lint(ctx)` — точка входу concern-у: обходить усі Tauri app workspaces
(`findTauriAppWorkspaces`) і перевіряє кожен.
