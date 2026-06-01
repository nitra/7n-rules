/**
 * Handler-и підкоманд `flow` (spec §8). Уся IO — через ін'єктовані `run`/`log`/
 * `fingerprint`/`now`, щоб логіку тестувати без реальних процесів.
 *
 * Ф2 (Пасивний Турнікет): `init` (worktree + стан), `verify` (Суддя), `release`
 * (change + completion snapshot). `run`/`resume`/`cancel`/`repair` — Ф4.
 */
import { spawnSync } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { worktreePaths } from '../../lib/worktree.mjs'
import { worktreeFingerprint } from '../../utils/worktree-fingerprint.mjs'
import { flowEventsPath } from './events.mjs'
import { detectLevel } from './level.mjs'
import { runReview } from './reviewer.mjs'
import { buildCompletionSnapshot, writeSummaryToTaskRecord } from './snapshot.mjs'
import { flowStatePath, readState, recordTransition, writeState } from './state-store.mjs'

/**
 * Реальний sync-runner із захопленням виводу.
 * @param {string} cmd виконуваний
 * @param {string[]} args аргументи
 * @param {object} [opts] додаткові опції spawnSync (напр. `cwd`)
 * @returns {{ status: number, stdout: string, stderr: string }} результат
 */
export function realRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Чи `cwd` — уже linked worktree (не основний checkout і не submodule).
 * @param {(cmd: string, args: string[], opts: object) => { status: number, stdout: string }} run runner
 * @param {string} cwd робочий каталог
 * @returns {boolean} true, якщо вже в worktree
 */
function inLinkedWorktree(run, cwd) {
  const gitDir = run('git', ['rev-parse', '--git-dir'], { cwd })
  const gitCommon = run('git', ['rev-parse', '--git-common-dir'], { cwd })
  if ((gitDir.status ?? 1) !== 0 || (gitCommon.status ?? 1) !== 0) return false
  const superproject = run('git', ['rev-parse', '--show-superproject-working-tree'], { cwd })
  const isSubmodule = (superproject.stdout ?? '').trim() !== ''
  return !isSubmodule && (gitDir.stdout ?? '').trim() !== (gitCommon.stdout ?? '').trim()
}

/**
 * `flow init <branch> "<опис>"` — ізоляція + ініціалізація стану (§8.1). Якщо вже
 * в worktree — не вкладає новий (detect existing isolation).
 * @param {string[]} rest аргументи: `<branch> <опис...>`
 * @param {{ run?: (cmd: string, args: string[], opts: object) => { status: number, stdout: string, stderr: string }, cwd?: string, log?: (m: string) => void, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
/**
 * Гарантує worktree для задачі: парсить `<branch> <опис>`, детектить існуючу
 * ізоляцію (§8.1) або створює новий worktree, читає `base_commit`. Спільне для
 * `init` (Фасад A) і `run` (Фасад B).
 * @param {string[]} rest аргументи `<branch> <опис...>`
 * @param {{ run?: (cmd: string, args: string[], opts: object) => object, cwd?: string, log?: (m: string) => void }} [deps] ін'єкції
 * @returns {{ code: number, worktreeDir?: string, branch?: string, desc?: string, baseCommit?: string | null }} результат
 */
export function ensureWorktree(rest, deps = {}) {
  const run = deps.run ?? realRun
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error

  const branch = rest[0]
  const desc = rest.slice(1).join(' ').trim()
  if (!branch || !desc) {
    log('Usage: n-cursor flow <init|run> <branch> "<опис>"')
    return { code: 1 }
  }

  let worktreeDir
  if (inLinkedWorktree(run, cwd)) {
    worktreeDir = cwd
    log(`flow: уже в worktree (${cwd}) — не вкладаю новий`)
  } else {
    const add = run('npx', ['@nitra/cursor', 'worktree', 'add', branch, desc], { cwd })
    if ((add.status ?? 1) !== 0) {
      const detail = add.stderr ? `: ${add.stderr.trim()}` : ''
      log(`flow: worktree add не вдався${detail}`)
      return { code: 1 }
    }
    worktreeDir = worktreePaths(cwd, branch).checkout
  }

  const head = run('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir })
  const baseCommit = (head.status ?? 1) === 0 ? (head.stdout ?? '').trim() : null
  return { code: 0, worktreeDir, branch, desc, baseCommit }
}

/**
 * `flow init <branch> "<опис>"` — ізоляція + ініціалізація стану (§8.1).
 * @param {string[]} rest аргументи `<branch> <опис...>`
 * @param {{ run?: (cmd: string, args: string[], opts: object) => object, cwd?: string, log?: (m: string) => void, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function init(rest, deps = {}) {
  const ew = ensureWorktree(rest, deps)
  if (ew.code !== 0) return ew.code
  const now = deps.now ?? Date.now
  const log = deps.log ?? console.error
  const statePath = flowStatePath(ew.worktreeDir)
  const level = detectLevel(ew.desc)
  writeState(statePath, {
    branch: ew.branch,
    status: 'in_progress',
    started_at: new Date(now()).toISOString(),
    metadata: { base_commit: ew.baseCommit },
    level,
    plan: []
  })
  log(`init: ${ew.branch} (level ${level}) → ${statePath}`)
  return 0
}

/**
 * `flow verify` — проганяє Quality Gates у поточному worktree (Турнікет, §8.1).
 * На фейл друкує вивід проваленого gate. Якщо поряд є стан — записує
 * gate-результати + fingerprint. Read-only щодо коду.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {{ run?: (cmd: string, args: string[], opts: object) => { status: number, stdout: string, stderr: string }, cwd?: string, log?: (m: string) => void, fingerprint?: () => string | null }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0 — pass, 1 — fail)
 */
export async function verify(_rest, deps = {}) {
  const run = deps.run ?? realRun
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const fingerprint = deps.fingerprint ?? (() => worktreeFingerprint())

  const statePath = flowStatePath(cwd)
  const state = readState(statePath)
  // М'які ворота: відсутній план — лише попередження, exit-код визначають gate-и.
  if (state && !(state.plan?.length)) {
    log('⚠️ verify: плану не зафіксовано (`flow plan`) — рекомендовано спершу сформувати план')
  }

  const verdict = runReview({ run, cwd, fingerprint })

  for (const g of verdict.gates) {
    log(`${g.ok ? '✅' : '❌'} gate: ${g.name}`)
  }
  if (!verdict.pass && verdict.failedOutput) log(verdict.failedOutput)
  log(verdict.pass ? '✅ verify: усі gate-и пройдено' : '❌ verify: провалено')

  if (state) {
    recordTransition(
      { statePath, eventsPath: flowEventsPath(cwd) },
      { type: 'verify', pass: verdict.pass },
      state => ({
        ...state,
        gates: verdict.gates,
        fingerprint: verdict.fingerprint,
        status: verdict.pass ? state.status : 'failed'
      })
    )
  }

  return verdict.pass ? 0 : 1
}

/**
 * `flow release [--bump … --section … --message …]` — генерує `.changes` і пише
 * completion snapshot (§3 Ф5, §7). Потребує наявного стану (`init`).
 * @param {string[]} rest аргументи, що прокидаються у `n-cursor change`
 * @param {{ run?: (cmd: string, args: string[], opts: object) => { status: number, stdout: string, stderr: string }, cwd?: string, log?: (m: string) => void, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function release(rest, deps = {}) {
  const run = deps.run ?? realRun
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const now = deps.now ?? Date.now

  const statePath = flowStatePath(cwd)
  const state = readState(statePath)
  if (!state) {
    log('release: стану нема — спершу `flow init`')
    return 1
  }
  // М'які ворота: FAIL-гейт — лише попередження, рішення за людиною.
  if (state.gate?.verdict === 'FAIL') {
    log(`⚠️ release: gate = FAIL (score ${state.gate.score}) — релізиш свідомо? (див. flow gate)`)
  }

  const ch = run('npx', ['@nitra/cursor', 'change', ...rest], { cwd })
  if ((ch.status ?? 1) !== 0) {
    const detail = ch.stderr ? `: ${ch.stderr.trim()}` : ''
    log(`release: change не вдався${detail}`)
    return 1
  }

  const snapshot = buildCompletionSnapshot({ ...state, status: 'done' }, now)
  recordTransition(
    { statePath, eventsPath: flowEventsPath(cwd) },
    { type: 'release' },
    state_ => ({ ...state_, status: 'done', completion: snapshot }),
    now
  )
  if (state.task) {
    writeSummaryToTaskRecord(isAbsolute(state.task) ? state.task : join(cwd, state.task), snapshot)
  }
  log('release: done')
  return 0
}
