/**
 * cwd-незалежний резолвер активного flow (беклог адаптації #1).
 *
 * Команди `spec/plan/verify/review/gate/release` мають знаходити `.flow.json`
 * поточної задачі навіть коли їх запущено НЕ з кореня worktree (напр. з головного
 * дерева чи з підтеки worktree) — інакше `flowStatePath(cwd)` обчислює хибний шлях
 * і видає «стану нема», хоча flow активний.
 *
 * Порядок (spec 2026-06-01-flow-cwd-state-resolution):
 *  1. явний `branch` → `.worktrees/<sanitizeBranch>.flow.json`;
 *  2. toplevel-резолвинг: `git rev-parse --show-toplevel` від `cwd`; якщо toplevel
 *     лежить безпосередньо під `<repoRoot>/.worktrees/` і для нього є стан — беремо;
 *  3. скан `<repoRoot>/.worktrees/*.flow.json` зі `status: in_progress`: рівно один →
 *     авторезолв; кілька → помилка зі списком; нуль → «стану нема».
 *
 * Резолвер не пише на диск. `git`/FS ін'єктуються — тестується без репозиторію.
 */
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { sanitizeBranch, worktreePaths } from '../../lib/worktree.mjs'
import { flowStatePath, readState as defaultReadState } from './state-store.mjs'

const FLOW_STATE_SUFFIX = '.flow.json'

/**
 * Реальний sync git-runner у заданому `cwd`.
 * @param {string[]} args аргументи git
 * @param {string} cwd робочий каталог
 * @returns {{ status: number, stdout: string }} результат
 */
function realGit(args, cwd) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '' }
}

/**
 * Корінь головного worktree через `git worktree list --porcelain` (перший запис).
 * @param {(args: string[]) => { status: number, stdout: string }} git git-runner
 * @returns {string | null} абсолютний шлях кореня репо або `null`
 */
function mainRepoRoot(git) {
  const r = git(['worktree', 'list', '--porcelain'])
  if ((r.status ?? 1) !== 0) return null
  const line = r.stdout.split('\n').find(l => l.startsWith('worktree '))
  const root = line ? line.slice('worktree '.length).trim() : ''
  return root.length > 0 ? root : null
}

/**
 * Корінь поточного worktree (`git rev-parse --show-toplevel`).
 * @param {(args: string[]) => { status: number, stdout: string }} git git-runner
 * @returns {string | null} абсолютний шлях або `null`
 */
function currentToplevel(git) {
  const r = git(['rev-parse', '--show-toplevel'])
  return (r.status ?? 1) === 0 && r.stdout.trim().length > 0 ? r.stdout.trim() : null
}

/**
 * @typedef {object} ResolvedFlow
 * @property {string | null} statePath абсолютний шлях `.flow.json` або `null`
 * @property {string | null} worktreeDir тека worktree (ефективний cwd для гейтів) або `null`
 * @property {string | null} label мітка flow (sanitized branch) або `null`
 * @property {boolean} autoResolved `true`, якщо знайдено скануванням (cwd поза worktree)
 * @property {string | null} error повідомлення для логу, якщо `statePath === null`
 */

/**
 * Резолвить активний flow незалежно від `cwd`.
 * @param {{ cwd?: string, branch?: string }} [params] параметри
 * @param {{ git?: (args: string[]) => { status: number, stdout: string }, exists?: (p: string) => boolean, readState?: (p: string) => object | null, readdir?: (d: string) => string[], repoRoot?: string }} [deps] ін'єкції
 * @returns {ResolvedFlow} результат
 */
export function resolveActiveFlowState({ cwd = processCwd(), branch } = {}, deps = {}) {
  const git = deps.git ?? (args => realGit(args, cwd))
  const exists = deps.exists ?? existsSync
  const readState = deps.readState ?? defaultReadState
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))

  const resolveRoot = () => deps.repoRoot ?? mainRepoRoot(git)

  // 1. Явний --branch завжди перемагає. Валідуємо існування теки worktree, щоб
  //    команда не пішла виконувати гейти в неіснуючому каталозі (ENOENT).
  if (branch) {
    const repoRoot = resolveRoot()
    if (!repoRoot) return notFound('стану нема — спершу `flow init`')
    const label = sanitizeBranch(branch)
    const worktreeDir = worktreePaths(repoRoot, branch).checkout
    if (!exists(worktreeDir)) {
      return notFound(`worktree для гілки «${branch}» не знайдено (${worktreeDir}) — перевір назву або зроби \`flow init\``)
    }
    return { statePath: flowStatePath(worktreeDir), worktreeDir, label, autoResolved: false, error: null }
  }

  // 2. Швидкий шлях без git: `cwd` уже є текою worktree зі станом-sibling
  //    (звичайний запуск із кореня worktree).
  const direct = flowStatePath(cwd)
  if (exists(direct)) {
    return { statePath: direct, worktreeDir: cwd, label: basename(cwd), autoResolved: false, error: null }
  }

  // Далі потрібен корінь репо (git). Якщо недоступний — трактуємо як «стану нема».
  const repoRoot = resolveRoot()
  if (!repoRoot) return notFound('стану нема — спершу `flow init`')
  const worktreesDir = join(repoRoot, '.worktrees')

  // 3. Якщо ми ВСЕРЕДИНІ worktree (toplevel під .worktrees/, у т.ч. з підтеки) —
  //    беремо стан саме цього worktree. Якщо його нема — це проблема цього worktree
  //    (`flow init` не зроблено); чужий активний flow НЕ підтягуємо.
  const top = currentToplevel(git)
  if (top && dirname(top) === worktreesDir) {
    const statePath = flowStatePath(top)
    if (exists(statePath)) {
      return { statePath, worktreeDir: top, label: basename(top), autoResolved: false, error: null }
    }
    return notFound('стану нема — спершу `flow init`')
  }

  // 4. Поза worktree (головне дерево) — скан активних flow.
  const active = []
  for (const name of readdir(worktreesDir)) {
    if (!name.endsWith(FLOW_STATE_SUFFIX)) continue
    const statePath = join(worktreesDir, name)
    let state
    try {
      state = readState(statePath)
    } catch {
      continue // пошкоджений стан — пропускаємо при скануванні
    }
    if (state?.status === 'in_progress') {
      const label = name.slice(0, -FLOW_STATE_SUFFIX.length)
      active.push({ statePath, worktreeDir: join(worktreesDir, label), label })
    }
  }
  if (active.length === 1) {
    return { ...active[0], autoResolved: true, error: null }
  }
  if (active.length > 1) {
    const list = active.map(a => `  - ${a.label}`).join('\n')
    return notFound(`кілька активних flow — уточни \`--branch <гілка>\` або \`cd\` у потрібний worktree:\n${list}`)
  }
  return notFound('стану нема — спершу `flow init`')
}

/**
 * @param {string} error повідомлення
 * @returns {ResolvedFlow} результат без statePath
 */
function notFound(error) {
  return { statePath: null, worktreeDir: null, label: null, autoResolved: false, error }
}
