[package]
name = "__CRATE_NAME__"
version = "0.1.0"
edition = "2021"
publish = false
license = "Apache-2.0"
description = "wasm-компонент n-rules:plugin@5.0.0 — __PLUGIN_ID__ (__CONCERN_ID__)"

[lib]
# `cdylib` — обов'язково: `wasm32-wasip2` виводить готовий Component Model
# компонент лише з цього crate-type (те саме, що `crates/plugin-lang-js`
# і `crates/test-plugin-guest`).
crate-type = ["cdylib"]

[dependencies]
# Пін звірено з реального плагіна (crates/plugin-lang-js/Cargo.toml) — той
# самий мінор, що резолвиться в Cargo.lock кореня (0.60.0 на момент
# написання скіла). НЕ розширюй у caret-діапазон без причини — wit-bindgen
# генерує ABI-код, версійний дрейф між гостем і `rules-plugin-host`
# (wit-bindgen-незалежний Rust-хост, але той самий WIT-контракт) краще ловити
# явним оновленням піна, ніж мовчазним semver-стрибком.
wit-bindgen = "0.60"
# Додай сюди залежності самої логіки концерну (напр. `regex = "1"`, як у
# `crates/plugin-lang-js`) — лише ті, що компілюються під `wasm32-wasip2` без
# додаткових features (стандартна бібліотека Rust підмножина WASI Preview 2
# достатня для більшості text/AST-парсерів).
