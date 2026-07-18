---
type: JS Module
title: cargo-diff.mjs
resource: plugins/lang-rust/taze/cargo-diff.mjs
docgen:
  crc: 5cdbc092
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Порівнює версії залежностей `Cargo.toml` між станами репозиторію (поточний файл vs `.taze-bak`-бекап) за тим самим caret-правилом major/minor, що й npm-diff ядра (`isBreaking` з `@7n/rules/plugin-api`). Дає змогу без падіння отримувати версійний specifier, зіставляти два розпарсені маніфести й збирати diff по списку файлів. Для невалідного TOML, `path/git`-залежностей і інших невідновлюваних випадків повертає порожній результат замість винятку.

## Поведінка

- parseCargoVersion — перетворює Cargo-рядок версії на числове ядро версії або повертає null для неверсійних значень.
- extractCargoVersionSpec — дістає версійний specifier із запису залежності Cargo.toml або повертає null для path/git-залежностей без версії.
- diffCargoToml — порівнює два розпарсені Cargo.toml і повертає зміни залежностей, розділяючи major та minor/patch.
- collectCargoDiff — проходить по списку Cargo.toml у монорепо, порівнює поточні файли з їхніми backup-версіями та агрегує diff; для відсутніх або невалідних TOML-файлів пропускає їх без падіння.

## Публічний API

- parseCargoVersion — Розбирає версійний specifier Cargo з 1–3 частин; відсутні частини трактує як `0`.
- extractCargoVersionSpec — Витягає версійний specifier із запису залежності в `Cargo.toml`, як із рядка, так і з `version` в inline-таблиці.
- diffCargoToml — Порівнює два розпарсені `Cargo.toml` і повертає зміни залежностей у форматі, сумісному з `diffPackageJson`.
- collectCargoDiff — Обходить усі `Cargo.toml` у монорепо й збирає diff між кожним маніфестом і його backup-версією у форматі `collectTazeDiff`.

Changelog: not run

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
