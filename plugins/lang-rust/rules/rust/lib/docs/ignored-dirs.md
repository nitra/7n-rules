---
type: JS Module
title: ignored-dirs.mjs
resource: plugins/lang-rust/rules/rust/lib/ignored-dirs.mjs
docgen:
  crc: 6110b7d8
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл задає спільну політику `RUST_WALK_IGNORED_DIR_NAMES` для Rust-walker'ів під час пошуку `Cargo.toml`. Він потрібен, щоб перевірки не заходили в `.git`, `node_modules`, build-артефакти та сесійні worktree-копії `.worktrees/` і `.claude/worktrees/`, де дублікати маніфестів створюють шум і хибні violations.

Політика закріплює захист від регресії, виявленої в `rust/workspace_root` PR #179: 12 хибних violations із двох stale auto-created worktree.

## Поведінка

1. `RUST_WALK_IGNORED_DIR_NAMES` визначає єдиний набір службових каталогів, які Rust-перевірки мають оминати під час пошуку маніфестів у дереві проєкту.

2. Список відсікає директорії залежностей, артефактів збірки, віртуальних середовищ і тимчасових worktree-копій, щоб перевірки працювали лише з актуальною структурою репозиторію.

3. Каталоги `.git` і `node_modules` свідомо пропускаються, бо вони не є джерелом робочих Rust-маніфестів для правил і можуть додавати шум у результати.

4. Наявність `.claude` і `.worktrees` у списку запобігає повторному обходу повних копій репозиторію та хибним порушенням через дублікати `Cargo.toml`.

5. Файл лише надає спільну політику ігнорування для Rust-walker'ів і не змінює файлову систему чи інші зовнішні сховища.

## Публічний API

- RUST_WALK_IGNORED_DIR_NAMES — Спільний список каталогів, які Rust-walker'и (`rust/applies`, `rust/workspace_root`)
НЕ заходять під час пошуку `Cargo.toml` у дереві: build-артефакти, vcs, залежності,
і сесійні worktree-чекаути (`.worktrees/`, `.claude/worktrees/`) — повні копії
репозиторію, у яких walker інакше знаходить дублі маніфестів і сипле хибні violations
(rust/workspace_root PR #179: 12 хибних violations з двох stale auto-created worktree).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
