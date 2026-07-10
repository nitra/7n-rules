---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/linux_deps/main.mjs
docgen:
  crc: add9f0f3
---

## Огляд

Read-only detector концерну `tauri/linux_deps` (tauri.mdc). У Tauri-проєкті перевіряє, що `.github/workflows/lint-rust.yml` містить крок встановлення системних залежностей Linux — без них Clippy падає на збірці `-sys`-крейтів (webkit2gtk, gtk, appindicator), чиї build-скрипти шукають системні бібліотеки через pkg-config.

## Поведінка

- Правило активується лише коли хоч у одному workspace-пакеті є `src-tauri/Cargo.toml`; інакше — жодних порушень.
- Якщо `.github/workflows/lint-rust.yml` відсутній — порушення не звітується: існування файла перевіряє `rust.lint_rust_yml`.
- Аналіз текстовий (не YAML-AST), як у `rust/toolchain_cache`: шукається перший рядок з `apt-get install`, а канонічні пакети — як substring по всьому файлу (пакет може стояти на continuation-рядку багаторядкового `run: |`).
- Немає жодного `apt-get install` → порушення `missing-linux-deps-step`.
- apt-рядок є, але бракує канонічних пакетів → порушення `missing-linux-deps-packages` з переліком відсутніх у `data.missing`.
- Перевірка — підмножина: додаткові пакети в apt-рядку дозволені.

## Публічний API

- `MISSING_LINUX_DEPS_STEP`, `MISSING_LINUX_DEPS_PACKAGES` — стабільні reason-коди порушень.
- `LINT_RUST_YML` — шлях цільового workflow-файла.
- `REQUIRED_LINUX_PACKAGES` — канонічні dev-пакети Tauri v2: `libwebkit2gtk-4.1-dev` (WebView), `libayatana-appindicator3-dev` (tray), `librsvg2-dev` (іконки).
- `scanLinuxDeps(content)` — сканує вміст workflow: `{ aptLine, missing }` (індекс першого apt-рядка або −1; відсутні канонічні пакети).
- `lint(ctx)` — стандартна lint-поверхня концерну; повертає результат із порушеннями.

## Де використовується

- Автофікс `fix-linux_deps.mjs` імпортує `scanLinuxDeps`/`REQUIRED_LINUX_PACKAGES` і reason-коди для T0-патернів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
