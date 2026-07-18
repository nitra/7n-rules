---
type: JS Module
title: rust-provider.mjs
resource: npm/skills/taze/js/rust-provider.mjs
docgen:
  crc: 5f9de45d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Огляд

Модуль `rustProvider` об’єднує публічні кроки для роботи з Cargo-залежностями: `findCargoManifests` знаходить `Cargo.toml` у репозиторії, `buildCargoDependencyPrompt` готує запит для major-оновлення Rust-крейта, `backupCargoManifests` створює резервні копії маніфестів, а `cleanupCargoBackups` прибирає їх після завершення.  

`rustProvider` — вбудований first-party EcosystemProvider Rust/Cargo для taze-оркестратора (контракт `@7n/rules/plugin-api`); до фази 2 живе в ядрі, далі виїде в `@7n/rules-lang-rust`. Модуль виконує реальні файлові операції (бекапи `Cargo.toml`/`Cargo.lock`) і запускає зовнішні команди (`find`, `cargo upgrade`/`cargo update`) — не read-only; сам до мережі не звертається (посилання на crates.io — лише текст промпта для раннера).

## Поведінка

- `buildCargoDependencyPrompt` — формує текст завдання для перевірки major-оновлення одного Rust-крейта: підказує звірити breaking changes через сторінку на `https://crates.io/crates/`, changelog або releases репозиторію, знайти зачеплене використання в коді й або нічого не змінювати, або виконати сумісний рефакторинг із підсумком у відповіді.
- `findCargoManifests` — знаходить `Cargo.toml` у репозиторії, свідомо пропускаючи `node_modules`, `.worktrees` і `target`.
- `backupCargoManifests` — створює резервні копії всіх знайдених `Cargo.toml` і спільного кореневого `Cargo.lock`.
- `cleanupCargoBackups` — видаляє резервні копії `Cargo.toml` і `Cargo.lock` після завершення роботи.
- `rustProvider` — описує вбудованого provider для Rust/Cargo в taze: визначає виявлення маніфестів, перевірку доступності через `cargo-edit`, резервне копіювання, оновлення залежностей, побудову prompt і очищення бекапів.

## Публічний API

- buildCargoDependencyPrompt — Формує prompt для одного LLM-циклу оновлення major-версії одного Rust-крейта; оркестратор окремо робить решту кроків без LLM.
- findCargoManifests — Підбирає всі `Cargo.toml`, оминаючи `node_modules`, `.worktrees` і `target`.
- backupCargoManifests — Зберігає копії кожного `Cargo.toml` і спільного кореневого `Cargo.lock`; розраховано на один workspace-lock у корені `cwd`, без підтримки кількох незалежних workspace.
- cleanupCargoBackups — Видаляє тимчасові бекапи `Cargo.toml` і `Cargo.lock` після завершення роботи.
- rustProvider — Вбудований Rust/Cargo provider для taze-оркестратора у форматі `@7n/rules/plugin-api`; надалі має перейти в `@7n/rules-lang-rust`.

## Гарантії поведінки

- Виконує файлові операції (бекапи) і запускає зовнішні команди (`find`, `cargo`) — НЕ read-only.
- Провал cargo-команди в `bump` кидає помилку з exit-кодом і stderr.
- Пошук маніфестів свідомо пропускає шляхи: `node_modules`, `.worktrees`, `target`.
