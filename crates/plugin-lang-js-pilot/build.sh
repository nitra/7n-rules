#!/usr/bin/env bash
# Збірка пілотного wasm-плагіна `plugin-lang-js-pilot` (задача K фази 6, спека
# `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.2) у
# `.wasm`-компонент — той самий підхід, що й `crates/test-plugin-guest/build.sh`
# (ціль `wasm32-wasip2` дає готовий Component Model компонент напряму, без
# окремого adapter-кроку — доккомент того файлу пояснює деталі й підстави).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="wasm32-wasip2"

if ! rustup target list --installed | grep -qx "$TARGET"; then
  echo "== rustup target add $TARGET =="
  rustup target add "$TARGET"
fi

echo "== cargo build --target $TARGET --release (plugin-lang-js-pilot) =="
cargo build --target "$TARGET" --release

WASM_PATH="$SCRIPT_DIR/../../target/$TARGET/release/plugin_lang_js_pilot.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "не вдалось знайти зібраний компонент: $WASM_PATH" >&2
  exit 1
fi

echo "OK: $WASM_PATH"
