#!/usr/bin/env bash
# Збірка guest-фікстури contract-test-kit `crates/rules-plugin-host` (задача
# I2 фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`)
# у `.wasm`-компонент, який `cargo test -p rules-plugin-host` завантажує
# напряму.
#
# Ціль — `wasm32-wasip3` (спека `docs/specs/2026-08-31-plugin-contract-v5.md`,
# розділ 10.1, крок 4 порядку реалізації) — та сама хвиля, що мігрувала
# шість first-party гостей (доккомент `crates/plugin-lang-php/build.sh`,
# та сама форма). `wasm32-wasip3` НЕ роздає precompiled `std` через rustup,
# тож збірка вимагає `-Z build-std=std,panic_abort` (nightly, пінований у
# `rust-toolchain.toml` кореня репо) і лінкер+CRT з WASI SDK
# (`crates/wasm-sdk/fetch-wasi-sdk.sh`).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="wasm32-wasip3"

# shellcheck source=../wasm-sdk/fetch-wasi-sdk.sh
source "$SCRIPT_DIR/../wasm-sdk/fetch-wasi-sdk.sh"

export CARGO_TARGET_WASM32_WASIP3_LINKER="$WASI_SDK_COMPONENT_LD"
export RUSTFLAGS="-L native=$WASI_SDK_P3_LIBDIR -C link-arg=$WASI_SDK_REACTOR_CRT"

echo "== cargo build -Z build-std=std,panic_abort --target $TARGET --release (test-plugin-guest) =="
cargo build -Z build-std=std,panic_abort --target "$TARGET" --release

WASM_PATH="$SCRIPT_DIR/../../target/$TARGET/release/test_plugin_guest.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "не вдалось знайти зібраний компонент: $WASM_PATH" >&2
  exit 1
fi

echo "OK: $WASM_PATH"
