/**
 * Завантаження конфігурації `.n-cursor.json` для graph-команд.
 *
 * Читає JSON з кореня репо (або з вказаного шляху), мержить із дефолтами.
 * Підтримує per-node override через task.md (якщо вузол передає свої налаштування).
 *
 * FS ін'єктується для тестованості без диска.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

/** Дефолтні значення конфігурації. */
export const CONFIG_DEFAULTS = {
  tasks_dir: './tasks',
  worktrees_dir: './.worktrees',
  warn_worktrees_above: 4,
  max_worktrees: 8,
  default_budget_sec: 1800,
  budget_hard_sec_multiplier: 3,
  progress_timeout_sec: 300,
  claude_model: 'claude-sonnet-4-6',
  audit_model: 'claude-haiku-4-5-20251001',
  model_map: {
    MIM: 'claude-haiku-4-5-20251001',
    AVG: 'claude-sonnet-4-6',
    MAX: 'claude-opus-4-8'
  },
  stale_worktree_min: 30,
  system_prompt: '.n-cursor/system-prompt.md'
}

/**
 * Завантажує конфігурацію з `.n-cursor.json` і мержить із дефолтами.
 * @param {{
 *   root?: string,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {typeof CONFIG_DEFAULTS} злита конфігурація
 */
export function loadConfig(deps = {}) {
  const root = deps.root ?? processCwd()
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.exists ?? existsSync

  const configPath = join(root, '.n-cursor.json')

  if (!exists(configPath)) {
    return { ...CONFIG_DEFAULTS }
  }

  let raw
  try {
    raw = JSON.parse(readFile(configPath, 'utf8'))
  } catch {
    return { ...CONFIG_DEFAULTS }
  }

  return {
    ...CONFIG_DEFAULTS,
    ...raw,
    model_map: {
      ...CONFIG_DEFAULTS.model_map,
      ...(raw.model_map ?? {})
    }
  }
}

/**
 * Повертає абсолютний шлях до tasks_dir.
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string} root корінь репо
 * @returns {string} абсолютний шлях
 */
export function resolveTasksDir(config, root) {
  const d = config.tasks_dir
  return d.startsWith('/') ? d : join(root, d)
}

/**
 * Повертає абсолютний шлях до worktrees_dir.
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string} root корінь репо
 * @returns {string} абсолютний шлях
 */
export function resolveWorktreesDir(config, root) {
  const d = config.worktrees_dir
  return d.startsWith('/') ? d : join(root, d)
}

/**
 * Резолвить модель за model_tier із model_map або повертає claude_model (дефолт).
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string | undefined} modelTier 'MIM' | 'AVG' | 'MAX'
 * @returns {string} model id
 */
export function resolveModelByTier(config, modelTier) {
  if (modelTier && config.model_map[modelTier]) {
    return config.model_map[modelTier]
  }
  return config.claude_model
}
