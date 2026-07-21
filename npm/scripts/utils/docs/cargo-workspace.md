---
type: JS Module
title: cargo-workspace.mjs
resource: npm/scripts/utils/cargo-workspace.mjs
docgen:
  crc: c852e1fe
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Спільні утиліти для читання `Cargo.toml`, розгортання `[workspace].members`-glob-патернів у каталоги та пошуку найближчого предка-workspace root для крейта. Публічні `readCargoManifest`, `resolveWorkspaceMemberDirs`, `isWorkspaceMemberDir`, `findAncestorWorkspaceRoot` працюють без запуску `cargo`, перехоплюють помилки й у частині випадків повертають порожнє значення замість винятку, щоб інші правила могли безпечно перевіряти належність каталогу до workspace або знаходити workspace root.

## Поведінка

- **readCargoManifest** — читає `Cargo.toml` і повертає розпарсений manifest, або `null`, якщо файл відсутній чи TOML невалідний.
- **resolveWorkspaceMemberDirs** — перетворює workspace-патерни на список абсолютних каталогів із власним `Cargo.toml`, усуваючи дублікати.
- **isWorkspaceMemberDir** — визначає, чи належить конкретний каталог до workspace з урахуванням `members` і `exclude`.
- **findAncestorWorkspaceRoot** — шукає найближчий предок `Cargo.toml` з `[workspace]`, чий workspace покриває крейт; сам каталог крейту не перевіряє.

## Публічний API

- readCargoManifest — Розпарсений Cargo.toml або null (файл відсутній чи невалідний TOML).
- resolveWorkspaceMemberDirs — Резолвить `[workspace].members`/`.exclude`-патерни (літеральні шляхи й прості
glob з `*`) відносно `rootDir` у список абсолютних каталогів, що мають власний
Cargo.toml. Без повної Cargo glob-семантики — лише `*`-сегменти й літерали.
- isWorkspaceMemberDir — Чи покриває `[workspace].members` (мінус `.exclude`) конкретний каталог-крейт.
- findAncestorWorkspaceRoot — Йде від `dirname(crateDirAbs)` вгору по предках до `repoRootAbs` (включно),
шукаючи найближчий Cargo.toml з `[workspace]`, чиї `members` (мінус `exclude`)
покривають `crateDirAbs`. Не перевіряє сам `crateDirAbs` (виклик для нього — окремо).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
