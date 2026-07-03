---
type: JS Module
title: main.mjs
resource: npm/rules/rust/toolchain_cache/main.mjs
docgen:
  crc: 360e0286
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Огляд
Конструкція забезпечує перевірку у `.github/workflows/*.yml` того, що кожен job, що використовує `dtolnay/rust-toolchain@stable` для встановлення Rust toolchain, має подальший крок із кешуванням Rust за допомогою `Swatinem/rust-cache@v2`. Якщо job також виконує `tauri-apps/tauri-action` і `Cargo.toml` лежить у `src-tauri/`, кеш-крок повинен мати `with.workspaces` на цей каталог. Ця логіка контролюється згідно з принципами, описаними у (rust.mdc), використовуючи константи `MISSING_RUST_CACHE` та `MISSING_RUST_CACHE_WORKSPACES` для маркування відхилень.

Поведінка
MISSING_RUST_CACHE — константа-рядок, яка позначає відсутність необхідного кешування Rust toolchain.
MISSING_RUST_CACHE_WORKSPACES — константа-рядок, що інформує про неправильну конфігурацію кешування для робочих просторів Rust.
TOOLCHAIN_RE — визначення для ідентифікації кроків встановлення Rust toolchain.
CACHE_RE — визначення для ідентифікації кроків, що використовують кешування Rust.
scanToolchainSteps — аналізує вміст YAML-файлу workflow, виявляючи кроки встановлення toolchain та інформацію про кешування в межах одного job-а.
tauriWorkspaceDir — визначає шлях до робочого простору Tauri, коли `Cargo.toml` не знаходиться в корені репозиторію.
lint — сканує всі `.yml` та `.yaml` файли у каталозі `.github/workflows`, перевіряючи відповідність вимогам кешування.
Інструмент працює лише з читанням конфігурацій (Read-only) та здійснює кешування інформації в межах поточного прогону.

## Поведінка

**Поведінка**
MISSING_RUST_CACHE — константа, що позначає відсутність необхідного кешування Rust toolchain.
MISSING_RUST_CACHE_WORKSPACES — константа, що позначає неправильну конфігурацію кешування для робочих просторів Rust.
TOOLCHAIN_RE — регулярний вираз для ідентифікації кроків, що встановлюють Rust toolchain.
CACHE_RE — регулярний вираз для ідентифікації кроків, що використовують кешування Rust.
scanToolchainSteps — аналізує вміст YAML-файлу workflow, виявляючи кроки встановлення toolchain та інформацію про кешування в межах одного job-а.
tauriWorkspaceDir — визначає шлях до робочого простору Tauri, якщо файл `Cargo.toml` не розташований у корені проєкту.
lint — сканує всі `.yml` та `.yaml` файли в каталозі `.github/workflows`, перевіряючи, чи присутні необхідні кешування для кроків Rust toolchain, і повідомляє про відхилення. При цьому ігнорує каталоги .github та .git.

## Публічний API

Understood. As a technical writer adhering to the specified constraints, I will transform the provided list into concise, action-oriented behavioral documentation in Ukrainian, using only bulleted markers ("name — what it does"). I will avoid all introductory/concluding remarks, code blocks, signatures, types, parameters, stdlib mentions, regex descriptions, and internal private names.

Here is the rewritten list:

*   MISSING_RUST_CACHE — Ідентифікатор, що позначає відсутність кешу Rust.
*   MISSING_RUST_CACHE_WORKSPACES — Ідентифікатор, що позначає відсутність кешу для Rust-робочих просторів.
*   TOOLCHAIN_RE — Маркер, що вказує на інструментарій.
*   CACHE_RE — Маркер, що стосується механізму кешування.
*   scanToolchainSteps — Виявляє всі етапи використання `dtolnay/rust-toolchain@…` у workflow-файлі, надаючи деталі про кешування та дії Tauri у відповідних завданнях.
*   tauriWorkspaceDir — Вказує на шлях до Rust-робочого простору для кешування, якщо `Cargo.toml` знаходиться в `src-tauri/`, інакше — не визначений.
*   lint — Здійснює перевірку коду на відповідність встановленим стандартам.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.github`, `.git`.
