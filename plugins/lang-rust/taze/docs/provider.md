---
type: JS Module
title: provider.mjs
resource: plugins/lang-rust/taze/provider.mjs
docgen:
  crc: 97a3dec1
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Rust/Cargo-провайдер (EcosystemProvider, контракт `@7n/rules/plugin-api`) для taze-оркестратора ядра; реєструється маніфестом `n-rules.contributes.handlers.taze` у package.json плагіна. Знаходить усі `Cargo.toml` workspace-у, бекапить маніфести + кореневий `Cargo.lock`, виконує bump (`cargo upgrade --incompatible allow` + `cargo update`), формує промпт одного major-крейта і прибирає бекапи. Публічні точки входу: `buildCargoDependencyPrompt`, `findCargoManifests`, `backupCargoManifests`, `cleanupCargoBackups`, `rustProvider`. Виконує файлові операції та запускає зовнішні команди (`find`, `cargo`) — не read-only; сам до мережі не звертається (посилання на crates.io — лише текст промпта для раннера).

## Поведінка

- `buildCargoDependencyPrompt` — формує текстовий prompt для перевірки major-оновлення одного Rust-крейта, спираючись на дані з `https://crates.io/crates/` та вже застосоване оновлення в `Cargo.toml` і `Cargo.lock`.
- `findCargoManifests` — знаходить усі `Cargo.toml` у репозиторії, пропускаючи `node_modules`, `.worktrees` і `target`.
- `backupCargoManifests` — створює резервні копії знайдених `Cargo.toml` і спільного кореневого `Cargo.lock`.
- `cleanupCargoBackups` — видаляє резервні копії `Cargo.toml` і `Cargo.lock` після завершення роботи.
- `rustProvider` — описує Rust/Cargo як taze-провайдер: визначає доступність через `cargo-edit`, запускає major-оновлення (`cargo upgrade`/`cargo update`), готує diff (`collectCargoDiff`), будує prompt і керує backup/cleanup.

## Публічний API

- buildCargoDependencyPrompt — готує один LLM-запит для оновлення одного Rust-крейта на кроці major-апгрейду; оркестратор окремо закриває детерміновані етапи 1–3 і 7–8.
- findCargoManifests — знаходить `Cargo.toml` у репозиторії, не заходячи в `node_modules`, `.worktrees` і `target`.
- backupCargoManifests — робить резервні копії кожного `Cargo.toml` і спільного кореневого `Cargo.lock`; зараз підтримується одна workspace-схема з єдиним `Cargo.lock` у корені `cwd`.
- cleanupCargoBackups — видаляє тимчасові бекапи `Cargo.toml` і `Cargo.lock` після завершення оновлення.
- rustProvider — підключає Rust/Cargo як ecosystem provider для taze через `@7n/rules/plugin-api`, а сам реєструється через `n-rules.contributes.handlers.taze` у package.json плагіна.

## Гарантії поведінки

- Виконує файлові операції (бекапи `Cargo.toml`/`Cargo.lock`) і запускає зовнішні команди (`find`, `cargo`) — НЕ read-only.
- Провал cargo-команди в `bump` кидає помилку з exit-кодом і stderr; graceful skip лише за відсутності cargo-edit.
- Пошук маніфестів свідомо пропускає шляхи: `node_modules`, `.worktrees`, `target`.
