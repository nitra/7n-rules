/**
 * Завантаження `.n-cursor.json` + per-node `.n-cursor-override.json`.
 * Всі поля опціональні — повертає merge із дефолтами.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @typedef {{ tasks_dir: string, worktrees_dir: string, warn_worktrees_above: number, max_worktrees: number, default_budget_sec: number, budget_hard_sec_multiplier: number, progress_timeout_sec: number, stderr_lines: number, claude_model: string, audit_model: string, model_map: Record<string,string>, stale_worktree_min: number, system_prompt: string }} GraphConfig */

/** @type {GraphConfig} */
const DEFAULTS = {
  tasks_dir: './tasks',
  worktrees_dir: './.worktrees',
  warn_worktrees_above: 4,
  max_worktrees: 8,
  default_budget_sec: 1800,
  budget_hard_sec_multiplier: 3,
  progress_timeout_sec: 300,
  stderr_lines: 50,
  claude_model: 'claude-sonnet-4-6',
  audit_model: 'claude-haiku-4-5-20251001',
  model_map: {
    MIM: 'claude-haiku-4-5-20251001',
    AVG: 'claude-sonnet-4-6',
    MAX: 'claude-opus-4-8',
  },
  stale_worktree_min: 30,
  system_prompt: '.n-cursor/system-prompt.md',
}

/**
 * Читає `.n-cursor.json` з root та мержить із дефолтами.
 * @param {string} root
 * @returns {GraphConfig}
 */
export function loadConfig(root) {
  const path = join(root, '.n-cursor.json')
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return { ...DEFAULTS, ...raw, model_map: { ...DEFAULTS.model_map, ...raw.model_map } }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Читає per-node `.n-cursor-override.json` та мержить із базовим конфігом.
 * @param {GraphConfig} base
 * @param {string} nodePath абсолютний шлях до директорії вузла
 * @returns {GraphConfig}
 */
export function loadNodeOverride(base, nodePath) {
  const path = join(nodePath, '.n-cursor-override.json')
  if (!existsSync(path)) return base
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return { ...base, ...raw }
  } catch {
    return base
  }
}
