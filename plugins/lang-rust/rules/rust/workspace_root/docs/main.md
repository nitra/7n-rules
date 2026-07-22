---
type: JS Module
title: main.mjs
resource: plugins/lang-rust/rules/rust/workspace_root/main.mjs
docgen:
  crc: 2524da2a
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує read-only правило для Rust-репозиторіїв: у дереві має бути рівно один кореневий Cargo workspace, а всі package-маніфести мають належати його members. Він існує, щоб без запуску `cargo` репортувати структурні відхилення `NESTED_WORKSPACE`, `NESTED_PROFILE`, `MISSING_ROOT_WORKSPACE`, `PACKAGE_NOT_WORKSPACE_MEMBER` від workspace-канону й уникати ризикового авто-виправлення.

`lint` працює fail-safe: перехоплює помилки й не кидає винятків назовні. Для частини помилкових станів результатом є порожнє значення на кшталт `null`, а не exception.

## Поведінка

`lint` працює як read-only перевірка структури Rust workspace: бере корінь репозиторію з lint-контексту, спирається на `package.json` як конфігураційний орієнтир про межі проєкту, знаходить Cargo-маніфести, читає їх без запуску `cargo` і перетворює знайдені невідповідності на violations.

Перевірка очікує один кореневий Cargo workspace. Якщо кореневий маніфест відсутній або не має workspace-опису, результат позначається через `MISSING_ROOT_WORKSPACE="missing-root-workspace"` як структурна проблема, яку не варто виправляти автоматично через ризик перенесення файлів або lockfile.

Після визначення кореневого workspace перевірка аналізує решту маніфестів як підлеглі package-маніфести. Вкладені workspace-оголошення в них репортуються через `NESTED_WORKSPACE="nested-workspace"`, а вкладені profile-налаштування — через `NESTED_PROFILE="nested-profile"`, бо ці правила мають належати кореню workspace.

Далі package-маніфести звіряються з members кореневого workspace. Маніфест, який існує в дереві репозиторію, але не покритий root workspace membership, репортується через `PACKAGE_NOT_WORKSPACE_MEMBER="package-not-workspace-member"`.

Усі результати повертаються як lint-звіт без змін у файловій системі. Невалідні або недоступні маніфести обробляються fail-safe: перевірка не кидає винятки назовні, а пропускає непридатні дані або повертає безпечний порожній результат там, де продовження неможливе.

## Публічний API

- NESTED_WORKSPACE — Стабільний reason: вкладений `[workspace]` поза кореневим Cargo.toml.
- NESTED_PROFILE — Стабільний reason: `[profile.*]` у не-кореневому Cargo.toml (Cargo його ігнорує).
- MISSING_ROOT_WORKSPACE — Стабільний reason: кореневий Cargo.toml без `[workspace]` при кількох крейтах.
- PACKAGE_NOT_WORKSPACE_MEMBER — Стабільний reason: крейт не входить у members кореневого workspace.
- lint — знаходить некоректно вкладені workspace-проєкти, відсутній root workspace для пакета та пакети, які не входять до оголошених workspace-членів, спираючись на package.json.

Експортовані константи-рядки позначають причини діагностик: NESTED_WORKSPACE="nested-workspace" — вкладений workspace там, де очікується один рівень керування; NESTED_PROFILE="nested-profile" — вкладений профіль workspace; MISSING_ROOT_WORKSPACE="missing-root-workspace" — пакет без кореневого workspace; PACKAGE_NOT_WORKSPACE_MEMBER="package-not-workspace-member" — пакет поза списком членів workspace.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
