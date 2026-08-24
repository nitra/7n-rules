#!/usr/bin/env bash
# Генеричний build-скрипт wasm-компонента plugin contract v3 — сировина скіла
# `wasm-plugin` (npm/skills/wasm-plugin/SKILL.md). Копіюється як є в новий
# guest-крейт (не `.tpl` — без плейсхолдерів, працює для будь-якої назви
# крейта): та сама ціль `wasm32-wasip2` без окремого adapter-кроку, що й
# `crates/plugin-lang-js-pilot/build.sh` / `crates/test-plugin-guest/build.sh`
# (доккомент того файлу пояснює деталі й підстави — `cargo build` для цієї
# цілі вже видає готовий Component Model компонент напряму).
#
# На відміну від тих двох файлів, шлях до `target/` тут обчислюється через
# `cargo metadata` замість хардкоду `../../target` — цей самий файл повинен
# однаково працювати і для крейта-члена цього monorepo-workspace
# (`crates/<name>/`, `target/` на два рівні вище), і для самостійного
# репозиторію стороннього плагіна (крейт — сам собі workspace root, `target/`
# просто поруч). Той самий build.sh ганяє й CI-смок скіла
# (`crates/rules-plugin-host/tests/wasm_plugin_skill_smoke.rs`), який
# скаффолдить крейт у tempdir поза цим репозиторієм — саме тому build.sh не
# може покладатись на фіксовану глибину вкладеності.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="wasm32-wasip2"

if ! rustup target list --installed | grep -qx "$TARGET"; then
  echo "== rustup target add $TARGET =="
  rustup target add "$TARGET"
fi

PKG_NAME="$(grep -m1 '^name' Cargo.toml | sed -E 's/^name[[:space:]]*=[[:space:]]*"(.*)"$/\1/')"
WASM_STEM="${PKG_NAME//-/_}"

echo "== cargo build --target $TARGET --release ($PKG_NAME) =="
cargo build --target "$TARGET" --release

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
