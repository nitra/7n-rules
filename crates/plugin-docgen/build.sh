#!/usr/bin/env bash
# Build-скрипт wasm-компонента plugin contract v5 — ПОХІДНИЙ від генеричного
# скрипта скіла `wasm-plugin` (`npm/skills/wasm-plugin/template/build.sh`,
# ще `wasm32-wasip2`, доккомент того файлу), але БІЛЬШЕ НЕ ідентичний йому:
# ціль — `wasm32-wasip3` (спека `docs/specs/2026-08-31-plugin-contract-v5.md`,
# розділ 10.1, крок 4 порядку реалізації). Шість first-party гостей
# (`plugin-lang-{js,python,rust,php}`, `plugin-ci-{github,azure}`) і
# `crates/test-plugin-guest` мігрували цією хвилею; шаблон скіла (сировина
# для НОВИХ third-party плагінів, поза цією хвилею) лишається на
# `wasm32-wasip2` — окрема хвиля, відкрите питання реєстру
# `docs/plans/2026-08-05-open-questions-register.md`.
#
# `wasm32-wasip3` НЕ роздає precompiled `std` через rustup (зміряно
# 2026-08-31: `rustc --print target-list` знає ціль, `rustup target list` —
# ні), тож збірка вимагає `-Z build-std=std,panic_abort` (нестабільна фіча
# — nightly, пінований у `rust-toolchain.toml` кореня репо) і лінкер+CRT з
# WASI SDK (`crates/wasm-sdk/fetch-wasi-sdk.sh`, спільний добувач, пінована
# версія — мінімум фінального `wasi-sdk-34`, доккомент того файлу).
#
# Шлях до `target/` — через `cargo metadata` (доккомент попередньої версії
# файлу залишається правдивим): працює і для крейта-члена цього
# monorepo-workspace, і для самостійного репозиторію стороннього плагіна.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="wasm32-wasip3"

# shellcheck source=../wasm-sdk/fetch-wasi-sdk.sh
source "$SCRIPT_DIR/../wasm-sdk/fetch-wasi-sdk.sh"

export CARGO_TARGET_WASM32_WASIP3_LINKER="$WASI_SDK_COMPONENT_LD"
export RUSTFLAGS="-L native=$WASI_SDK_P3_LIBDIR -C link-arg=$WASI_SDK_REACTOR_CRT"

PKG_NAME="$(grep -m1 '^name' Cargo.toml | sed -E 's/^name[[:space:]]*=[[:space:]]*"(.*)"$/\1/')"
WASM_STEM="${PKG_NAME//-/_}"

echo "== cargo build -Z build-std=std,panic_abort --target $TARGET --release ($PKG_NAME) =="
cargo build -Z build-std=std,panic_abort --target "$TARGET" --release

TARGET_DIR="$(cargo metadata --no-deps --format-version=1 2>/dev/null | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"
if [[ -z "$TARGET_DIR" ]]; then
  echo "не вдалось визначити target_directory з cargo metadata" >&2
  exit 1
fi

WASM_PATH="$TARGET_DIR/$TARGET/release/$WASM_STEM.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "не вдалось знайти зібраний компонент: $WASM_PATH" >&2
  exit 1
fi

echo "OK: $WASM_PATH"
