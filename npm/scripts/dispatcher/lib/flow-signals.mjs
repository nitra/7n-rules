/**
 * Handlers сигнальних команд `flow done/audit/failed/spawn` (думка.MD).
 *
 * Агент ніколи не знає свій абсолютний path — команди обчислюють path вузла з
 * env var `NCURSOR_NODE_PATH` (встановлюється wrapper-скриптом) або з файлу
 * `.n-cursor/current-node` у корені worktree. Якщо нічого — error.
 *
 * done    → делегує `n-cursor graph done <path>`
 * audit   → створює `pending-audit_NNN.md` → делегує `n-cursor graph audit <path>`
 * failed  → делегує `n-cursor graph failed <path>`
 * spawn   → делегує `n-cursor graph spawn <path>`
 *
 * Всі IO ін'єктуються для тестування без реальних процесів і диска.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

/**
 * Резолвить шлях вузла з env або fallback-файлу.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   cwd?: string,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} deps ін'єкції
 * @returns {{ nodePath: string | null, error: string | null }} результат
 */
export function resolveNodePath(deps = {}) {
  const env = deps.env ?? process.env
  const cwd = deps.cwd ?? processCwd()
  const exists = deps.exists ?? existsSync
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))

  // 1. Env var
  const fromEnv = env['NCURSOR_NODE_PATH']
  if (fromEnv && fromEnv.trim().length > 0) {
    return { nodePath: fromEnv.trim(), error: null }
  }

  // 2. Fallback-файл .n-cursor/current-node у CWD (корінь worktree)
  const fallbackPath = join(cwd, '.n-cursor', 'current-node')
  if (exists(fallbackPath)) {
    try {
      const content = readFile(fallbackPath, 'utf8').trim()
      if (content.length > 0) {
        return { nodePath: content, error: null }
      }
    } catch {
      // якщо не читається — fallthrough до error
    }
  }

  return { nodePath: null, error: 'NCURSOR_NODE_PATH not set and .n-cursor/current-node not found' }
}

/**
 * Знаходить поточний найбільший номер `outputs_NNN.md`.
 * @param {string} dir директорія вузла
 * @param {(dir: string) => string[]} readdir ін'єктована readdir
 * @returns {string | null} рядок типу `001` або null якщо не знайдено
 */
function findCurrentOutputsNum(dir, readdir) {
  const files = readdir(dir)
  let max = -1
  for (const f of files) {
    const m = f.match(/^outputs_(\d+)\.md$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max >= 0 ? String(max).padStart(3, '0') : null
}

/**
 * Виконує n-cursor graph <sub> <nodePath>.
 * @param {string} sub підкоманда graph
 * @param {string} nodePath шлях вузла
 * @param {{
 *   run: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }
 * }} deps
 * @returns {number} exit code
 */
function delegateToGraph(sub, nodePath, deps) {
  const result = deps.run('npx', ['@nitra/cursor', 'graph', sub, nodePath])
  return result.status ?? 1
}

/**
 * Реальний sync-runner процесу.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function realRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Базовий handler для сигнальних команд без аудиту.
 * @param {string} sub підкоманда graph
 * @param {{
 *   cwd?: string,
 *   env?: Record<string, string | undefined>,
 *   log?: (m: string) => void,
 *   run?: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string },
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} deps ін'єкції
 * @returns {Promise<number>} exit code
 */
async function signalHandler(sub, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const run = deps.run ?? realRun

  const { nodePath, error } = resolveNodePath({ env: deps.env, cwd, readFile: deps.readFile, exists: deps.exists })
  if (!nodePath) {
    log(`flow ${sub}: ${error}`)
    return 1
  }

  log(`flow ${sub}: node path = ${nodePath}`)
  const code = delegateToGraph(sub, nodePath, { run })
  if (code !== 0) {
    log(`flow ${sub}: graph ${sub} завершився з кодом ${code}`)
  }
  return code
}

/**
 * `flow done` — сигналізує успіх → `graph done <path>`.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function done(_rest, deps = {}) {
  return signalHandler('done', deps)
}

/**
 * `flow failed` — сигналізує провал → `graph failed <path>`.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function failed(_rest, deps = {}) {
  return signalHandler('failed', deps)
}

/**
 * `flow spawn` — сигналізує розклад → `graph spawn <path>`.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function spawn(_rest, deps = {}) {
  return signalHandler('spawn', deps)
}

/**
 * `flow audit` — створює `pending-audit_NNN.md` → `graph audit <path>`.
 *
 * NNN у `pending-audit_NNN.md` = NNN відповідного `outputs_NNN.md`.
 * Якщо outputs відсутні — error.
 *
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {{
 *   cwd?: string,
 *   env?: Record<string, string | undefined>,
 *   log?: (m: string) => void,
 *   run?: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string },
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, content: string, enc: string) => void,
 *   readdir?: (dir: string) => string[],
 *   exists?: (p: string) => boolean,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function audit(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const exists = deps.exists ?? existsSync
  const nowFn = deps.now ?? (() => new Date().toISOString())
  const run = deps.run ?? realRun

  const { nodePath, error } = resolveNodePath({ env: deps.env, cwd, readFile: deps.readFile, exists })
  if (!nodePath) {
    log(`flow audit: ${error}`)
    return 1
  }

  // Знаходимо поточний outputs NNN
  const outputsNum = findCurrentOutputsNum(cwd, readdir)
  if (!outputsNum) {
    log('flow audit: outputs_NNN.md не знайдено — спершу напиши outputs')
    return 1
  }

  const pendingPath = join(cwd, `pending-audit_${outputsNum}.md`)
  if (exists(pendingPath)) {
    log(`flow audit: ${pendingPath} вже існує — audit вже запитано для outputs_${outputsNum}.md`)
    return 1
  }

  const content = [
    '---',
    `created_at: ${nowFn()}`,
    `outputs_ref: outputs_${outputsNum}.md`,
    `actor: agent`,
    '---',
    ''
  ].join('\n')

  try {
    writeFile(pendingPath, content, 'utf8')
  } catch (err) {
    log(`flow audit: не вдалося записати ${pendingPath} — ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  log(`flow audit: ${pendingPath} створено`)
  log(`flow audit: node path = ${nodePath}`)
  const code = delegateToGraph('audit', nodePath, { run })
  if (code !== 0) {
    log(`flow audit: graph audit завершився з кодом ${code}`)
  }
  return code
}
