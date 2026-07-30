---
type: Rust Module
title: lib.rs
resource: crates/rules-napi/src/lib.rs
docgen:
  crc: fa7e597a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

napi-біндінги до `rules-core` для `@7n/rules`.  Тонкий binding: жодної власної логіки, лише передача виклику в `rules-core`. Окремий cdylib від `llm-lib-napi` (архітектура спеки `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`) — синхронна N-API поверхня (Р2), без `tokio_rt`, бо споживачі (`npm/scripts/lib/*`) викликають функції синхронно.

## Публічний API

- contract_version — Версія JSON DTO-контракту `rules-core` ⇄ `rules-napi` ([`rules_core::dto::CONTRACT_VERSION`]). JS-loader звіряє це значення при завантаженні аддона (Р10 спеки) — enforcement-точка за зразком `requiresPluginApi`.
- resolve_changed_base — Визначає git base для scoped-перевірок — тонкий binding над [`rules_core::changed_base::resolve_changed_base`] (T2 фази 1, Rust-порт `resolveChangedBase` з `changed-files.mjs:63`).  - `cwd` — робочий каталог (може бути linked worktree, зокрема `.claude/worktrees/...`). - `candidates` — уже розгорнутий список ref-ів (`origin/<name>`/`<name>`); розгортання Git policy лишається в JS-фасаді (Р5 спеки). - `base_ref` — явний ref бази; якщо заданий, `candidates` ігноруються (той самий пріоритет, що й у JS).  Повертає `None`, якщо жоден кандидат не дав merge-base (не git-репо, відсутній ref, немає HEAD тощо) — дзеркалить мовчазну поведінку JS-версії: синхронна поверхня (Р2 спеки) ніколи не кидає на «звичайних» негараздах git-резолву, лише на непередбачених (наразі — жодних, `RulesError` лишається про запас).
- sanitize_worktree_name — Санітизує довільний рядок (наприклад, `<current-branch>-<suffix>`) до безпечного компонента шляху worktree — тонкий binding над [`rules_core::worktree::sanitize_name`] (делегат `mt_core::sanitize`, Р3 спеки фази 2, задача B1).
- worktree_create — Створює dev-worktree — тонкий binding над [`rules_core::worktree::create_dev_worktree`], що відтворює семантику `mt worktree create <name> [--base <ref>] --description <d>` (Р3 спеки).  - `repo_root` — корінь репозиторію (worktree завжди створюється в `<repo_root>/.worktrees/<name>`, rules-конвенція). - `base` — `None` мапиться на `"main"`, той самий дефолт, що в `mt` CLI.  Повертає абсолютний шлях щойно створеного worktree.
- worktree_remove — Прибирає dev-worktree — тонкий binding над [`rules_core::worktree::remove_worktree`], що відтворює семантику `mt worktree remove <name> [--force]` (Р3 спеки), включно з видаленням гілки `mt/<name>`, якою worktree володіє.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
