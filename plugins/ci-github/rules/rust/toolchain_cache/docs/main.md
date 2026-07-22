---
type: JS Module
title: main.mjs
resource: plugins/ci-github/rules/rust/toolchain_cache/main.mjs
docgen:
  crc: e97443b2
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл виявляє у `.github/workflows/*.yml` job-и, де `dtolnay/rust-toolchain@stable` встановлює Rust toolchain без подальшого `Swatinem/rust-cache@v2`, щоб workflow не втрачали очікуване кешування Cargo-залежностей. Для job-ів із `tauri-apps/tauri-action` він додатково вимагає `with.workspaces` на `src-tauri/`, коли `Cargo.toml` лежить під `src-tauri/`, а не в корені репозиторію.

## Поведінка

`lint` запускає read-only перевірку GitHub Actions workflow-файлів. Дані з YAML-файлів передаються як текст, щоб зберегти коментарі й мінімізувати зміни формату; результатом є lint-повідомлення без власних записів у файлову систему.

`scanToolchainSteps` проходить workflow-контент і знаходить кроки Rust toolchain за `TOOLCHAIN_RE`, після чого в межах того самого job-а шукає наступний cache-крок за `CACHE_RE`. Межа job-а визначається відступами, тому перевірка прив’язана до фактичної структури `steps`, а не до повного YAML-парсингу. Якщо cache-крок відсутній після встановлення toolchain, `lint` повертає порушення `MISSING_RUST_CACHE` зі значенням `"missing-rust-cache"` — job має додати `Swatinem/rust-cache@v2`.

`tauriWorkspaceDir` додає проєктний контекст до текстового сканування: якщо Rust workspace розміщений у типовому Tauri-каталозі, а не в корені репозиторію, `lint` вимагає, щоб cache-крок у job-і з Tauri action мав окремо заданий workspace. За відсутності такого налаштування повертається порушення `MISSING_RUST_CACHE_WORKSPACES` зі значенням `"missing-rust-cache-workspaces"`.

## Публічний API

- MISSING_RUST_CACHE — Reason-код: job ставить Rust toolchain, але не має кроку `Swatinem/rust-cache@v2`.
- MISSING_RUST_CACHE_WORKSPACES — Reason-код: кеш-крок Tauri-job-а без `with.workspaces` на каталог `src-tauri`.
- TOOLCHAIN_RE — Рядок кроку встановлення Rust toolchain (`dtolnay/rust-toolchain@…`).
- CACHE_RE — Рядок кроку кешування Cargo-артефактів (`Swatinem/rust-cache@…`).
- scanToolchainSteps — Сканує вміст workflow-файла й повертає по одному запису на кожен
`dtolnay/rust-toolchain@…` крок, з інформацією про cache-крок і tauri-action
у тому самому job-і (обмежено indentation-dedent-ом).
- tauriWorkspaceDir — Каталог Rust-workspace-а для `Swatinem/rust-cache` `with.workspaces`, якщо
`Cargo.toml` не в корені репо, а під `src-tauri/` (типовий Tauri-layout).
`undefined`, якщо корінь репо вже є workspace-коренем (окремий крок не потрібен).
- lint — знаходить конфігурації Rust без потрібного cache для збірок і workspace, щоб CI не витрачав час на повторне завантаження залежностей.

Поведінка: повідомлення маркуються як (rust.mdc), щоб порушення було прив’язане до правила Rust.

Експортовані константи-рядки: MISSING_RUST_CACHE="missing-rust-cache" — позначає відсутній cache для Rust; MISSING_RUST_CACHE_WORKSPACES="missing-rust-cache-workspaces" — позначає відсутній cache для workspace-збірок Rust.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
