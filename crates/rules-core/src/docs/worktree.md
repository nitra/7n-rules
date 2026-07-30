---
type: Rust Module
title: worktree.rs
resource: crates/rules-core/src/worktree.rs
docgen:
  crc: c6e29764
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Worktree lifecycle через `mt-core` (Р3 спеки, фаза 2 задача B1 `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`) — тонка обгортка над крейтом `mt-core` (git dep `nitra/mt-rust`) з rules-конвенцією: `worktrees_dir` завжди `<repo_root>/.worktrees` (на відміну від `mt` CLI, де шлях резолвиться з `.mt.json` — конфіг-парсинг лишається в JS, Р5 спеки; тут дефолт той самий `./.worktrees`, тож поведінка збігається для repos без кастомного `.mt.json`).  Власних `git worktree`-викликів тут немає (Р3 спеки) — уся lifecycle- логіка делегується в `mt_core::worktree`, звірена з CLI-семантикою `mt worktree create|remove` (`crates/mt/src/commands/worktree.rs` у mt-rust, READ-ONLY референс).

## Публічний API

- sanitize_name — Санітизує довільний рядок (наприклад, `<current-branch>-<suffix>`) до безпечного компонента шляху worktree — прямий делегат у `mt_core::sanitize` (`crates/mt-core/src/lib.rs`): не-alphanum/не-`_`/не-`-` символи → `-`, без collapse/trim (на відміну від `mt_core::sanitize_branch`, яка йде іншим шляхом і тут не застосовна).  `mt worktree create <name>` (CLI) приймає ім'я як є, без власної санітизації — `mt_core::sanitize` є єдиною спільною нормалізацією імені worktree в самому крейті (вживається для worktree-prefix/task-matching у `mt_core::worktree::find_worktree_match`/`worktree_inventory`). Р3 спеки («Санітизація імені») обирає саме її як канон замість поточного JS `replaceAll('/', '-')` в `auto-worktree.mjs`.
- create_dev_worktree — Відтворює `mt worktree create <name> [--base <ref>] --description <d>` (`WorktreeAction::Create` у `crates/mt/src/commands/worktree.rs`):  1. `mt_core::worktree::create_dev_worktree(repo_root, worktrees_dir, name, base)` — гілковий (не detached) worktree `mt/<name>` від `base` (`git worktree add -b mt/<name> <worktrees_dir>/<name> <base>`). 2. `mt_core::worktree::set_branch_description(repo_root, "mt/<name>", description)` — той самий порядок кроків, що й CLI.  `base: None` мапиться на `"main"` — той самий дефолт, що clap `#[arg(long, default_value = "main")]` у CLI (на відміну від CLI, тут `description` не `Option`: rules-конвенція завжди її передає — консюмер `auto-worktree.mjs` теж завжди задає `--description`).  Повертає абсолютний шлях щойно створеного worktree.
- remove_worktree — Відтворює `mt worktree remove <name> [--force]` (`WorktreeAction::Remove` у `crates/mt/src/commands/worktree.rs`): знаходить запис `mt worktree list` за іменем (останній компонент шляху) і прибирає worktree РАЗОМ з гілкою `mt/<name>`, якою він володіє — `mt_core::worktree::remove_dev_worktree` відмовляє у видаленні, якщо запис worktree належить іншій гілці (foreign branch guard), той самий інваріант, що й CLI.  `force: false` відмовляє на брудному worktree (git-поведінка за замовчуванням, як у `mt_core::worktree::remove_worktree`); `force: true` — примусово, той самий прапорець, що CLI `--force`.

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
