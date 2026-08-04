/**
 * Спільний список каталогів, які Rust-walker'и НЕ заходять під час пошуку
 * `Cargo.toml` у дереві: build-артефакти, vcs, залежності, і сесійні
 * worktree-чекаути (`.worktrees/`, `.claude/worktrees/`) — повні копії
 * репозиторію, у яких walker інакше знаходить дублі маніфестів і сипле хибні violations
 * (rust/workspace_root PR #179: 12 хибних violations з двох stale auto-created worktree).
 *
 * Живих споживачів двоє, і другий — НЕ імпорт: концерн `rust/workspace_root`
 * бере список звідси, а rule-level гейт правила (`rust/main.json:applies`)
 * несе його ДАНИМИ в `globMatches.ignoreDirs` — гейт мусить читатися без
 * виконання JS. Розбіжність двох копій ловить тест-конвенція
 * `rust/tests/applies.test.mjs`.
 */
export const RUST_WALK_IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'target',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '.claude',
  'vendor',
  '.worktrees'
])
