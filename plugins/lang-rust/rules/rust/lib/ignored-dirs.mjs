/**
 * Спільний список каталогів, які Rust-walker'и (`rust/applies`, `rust/workspace_root`)
 * НЕ заходять під час пошуку `Cargo.toml` у дереві: build-артефакти, vcs, залежності,
 * і сесійні worktree-чекаути (`.worktrees/`, `.claude/worktrees/`) — повні копії
 * репозиторію, у яких walker інакше знаходить дублі маніфестів і сипле хибні violations
 * (rust/workspace_root PR #179: 12 хибних violations з двох stale auto-created worktree).
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
