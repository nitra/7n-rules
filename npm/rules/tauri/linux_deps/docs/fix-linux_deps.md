---
type: JS Module
title: fix-linux_deps.mjs
resource: npm/rules/tauri/linux_deps/fix-linux_deps.mjs
docgen:
  crc: 9b6951e2
---

## Огляд

T0-autofix концерну `tauri/linux_deps` (tauri.mdc): детерміновано приводить `.github/workflows/lint-rust.yml` до стану з системними залежностями Linux для Tauri. Текстові splice-и (як у `rust/toolchain_cache`) зберігають коментарі та формат файла й дають мінімальний diff.

## Поведінка

- Порушення `missing-linux-deps-step` → вставляє канонічний apt-крок (`sudo apt-get update` + `sudo apt-get install -y` з канонічними пакетами) перед першим кроком `dtolnay/rust-toolchain@…`, на тому самому рівні step-list-а.
- Якщо toolchain-кроку у файлі немає (нетипове форматування) — нічого не змінює: такий випадок лишається для T1/LLM.
- Порушення `missing-linux-deps-packages` → дописує відсутні канонічні пакети в кінець наявного `apt-get install`-рядка; trailing `\` shell-continuation зберігається (пакети вставляються перед ним).
- Ідемпотентно: перед вставкою стан файла заново перевіряється скануванням, повторний прогін не змінює файл.

## Публічний API

- `insertLinuxDepsStep(content)` — новий вміст workflow із канонічним apt-кроком або `null`, якщо крок уже є чи немає anchor-а.
- `appendMissingPackages(content)` — новий вміст із дописаними відсутніми пакетами або `null`, якщо дописувати нічого.
- `patterns` — T0-патерни (`tauri-linux-deps-insert`, `tauri-linux-deps-packages`) для центрального fix-pipeline: застосовують трансформери до файлів із відповідних порушень і записують зміни через `ctx.recordWrite`.

## Гарантії поведінки

- Пише лише файли, перелічені у violations; нечитабельні файли мовчки пропускає.
- Без змін вмісту запис не виконується.
