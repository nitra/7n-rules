#!/usr/bin/env bash
# Збірка guest-фікстури contract-test-kit `crates/rules-plugin-host` (задача
# I2 фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`)
# у `.wasm`-компонент, який `cargo test -p rules-plugin-host` завантажує
# напряму.
#
# Шлях без adapter-файлу (свідоме відхилення від чернетки задачі, яка
# описувала `cargo build --target wasm32-wasip1` + `wasm-tools component
# new` + WASI adapter): ціль `wasm32-wasip2` (стабільна в rustc з 1.82,
# тут — 1.95) генерує ГОТОВИЙ Component Model компонент напряму — `cargo
# build` для неї вже видає валідний `.wasm`-компонент (перевірено `wasm-tools
# validate --features component-model` і `wasm-tools component wit`), без
# окремого кроку конвертації чи потреби у
# `wasi_snapshot_preview1.reactor.wasm` adapter-і. Простіший і надійніший
# шлях за тих самих гарантій (той самий офіційний приклад у README
# `wit-bindgen` 0.60 демонструє САМЕ цю пару: `wasm32-wasip2` + `cargo
# build`, без adapter-кроку).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="wasm32-wasip2"

if ! rustup target list --installed | grep -qx "$TARGET"; then
  echo "== rustup target add $TARGET =="
  rustup target add "$TARGET"
fi

echo "== cargo build --target $TARGET --release (test-plugin-guest) =="
cargo build --target "$TARGET" --release

WASM_PATH="$SCRIPT_DIR/../../target/$TARGET/release/test_plugin_guest.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "не вдалось знайти зібраний компонент: $WASM_PATH" >&2
  exit 1
fi

echo "OK: $WASM_PATH"
