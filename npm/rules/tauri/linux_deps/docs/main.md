---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/linux_deps/main.mjs
docgen:
  crc: cf2b4f30
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Детектор `scanLinuxDeps` перевіряє, чи в Tauri-workspace файл `LINT_RUST_YML` містить крок `MISSING_LINUX_DEPS_STEP` з `apt-get install` для `REQUIRED_LINUX_PACKAGES` із `MISSING_LINUX_DEPS_PACKAGES`. Це потрібно, щоб Clippy у Linux не падав на збірці `-sys`-crate’ів через відсутні системні `.pc`-файли, які шукає `pkg-config` під час перевірки Rust-частини. `lint` застосовує цю перевірку лише до потрібного workflow і свідомо пропускає `.github` та `.git`, не зачіпаючи інші файли чи етапи збірки.

## Поведінка

Модуль працює лише для Tauri-проєкту: якщо в workspace є `src-tauri`, перевірка націлюється на `.github/workflows/lint-rust.yml`, а якщо таких проєктів немає — завершується без результату. Файл workflow читається як plain text, бо потрібна саме поведінкова звірка готового CI-кроку, а не структурний розбір; `scanLinuxDeps` знаходить наявність apt-встановлення та збирає перелік канонічних пакетів, яких бракує у вмісті файла. `REQUIRED_LINUX_PACKAGES` задає мінімальний набір Linux dev-залежностей для Clippy на Tauri, а `LINT_RUST_YML` фіксує єдиний цільовий workflow. Якщо кроку встановлення немає, `lint` формує порушення з `MISSING_LINUX_DEPS_STEP="missing-linux-deps-step"`; якщо крок є, але не всі канонічні пакети присутні, використовується `MISSING_LINUX_DEPS_PACKAGES="missing-linux-deps-packages"`. У повідомленнях і правилах послідовно відображається очікування з (tauri.mdc), а відсутній `.github/workflows/lint-rust.yml` вважається поза сферою цього детектора, бо його існування контролюється окремо.

## Публічний API

- MISSING_LINUX_DEPS_STEP — Стабільний reason: у CI-workflow немає apt-кроку встановлення Linux-залежностей Tauri.
- MISSING_LINUX_DEPS_PACKAGES — Стабільний reason: apt-крок є, але в ньому бракує канонічних пакетів.
- LINT_RUST_YML — Цільовий workflow-файл (канон `rust.lint_rust_yml`).
- REQUIRED_LINUX_PACKAGES — Канонічні dev-пакети для компіляції Tauri v2 на ubuntu-runner-і:
webkit2gtk-4.1 (WebView), ayatana-appindicator (tray), rsvg (іконки).
Перевірка — підмножина: додаткові пакети в apt-рядку дозволені.
- scanLinuxDeps — Сканує вміст workflow: перший `apt-get install`-рядок і перелік канонічних
пакетів, яких немає ніде у файлі (substring — пакет може стояти на
continuation-рядку багаторядкового `run: |`).
- lint — запускає набір правил для Rust-робочого дерева та повідомляє про проблеми в проектах, залежностях і CI-налаштуваннях, пов’язаних із Linux; у повідомленнях використовує маркер (tauri.mdc)

Поводження:
- Якщо не вистачає Linux-залежностей, фіксує це через `MISSING_LINUX_DEPS_STEP="missing-linux-deps-step"` і `MISSING_LINUX_DEPS_PACKAGES="missing-linux-deps-packages"`, щоб окремо показати крок і перелік пакетів для встановлення.
- Для перевірок Rust CI орієнтується на `LINT_RUST_YML=".github/workflows/lint-rust.yml"`, щоб прив’язати результати до конкретного workflow-файла.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.github`, `.git`.
