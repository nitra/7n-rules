/** @see ./docs/check.md */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Маркери довгого процесу (dev-сервер/демон) у команді `start`. */
const SERVER_CMD_RE = /\b(vite|next|nuxt|nodemon|serve|astro|remix|webpack-dev-server|http-server)\b|\bdev\b|--watch/
/** Рядки готовності dev-сервера в логу (`\b` лише де треба — щоб «already» не матчив «ready»). */
const READY_RE = /\bready\b|\blistening\b|\bstarted\b|\bcompiled\b|server running|local:/i
/** Сигнатури помилок у логу. */
const ERROR_RE = /(error|exception|fatal|cannot find|module not found|unhandled|panic|traceback)/i
/** Скільки останніх рядків логу повертати. */
const LOG_TAIL_LINES = 15

/**
 * Класифікує `start`-команду: довгий процес (сервер) чи разова дія (CLI).
 * @param {string} startCmd значення `scripts.start`
 * @returns {'server'|'cli'} тип процесу
 */
export function classifyStartType(startCmd) {
  return typeof startCmd === 'string' && SERVER_CMD_RE.test(startCmd) ? 'server' : 'cli'
}

/**
 * Зчитує `package.json` воркспейсу або повертає null.
 * @param {string} dir абсолютний шлях до каталогу воркспейсу
 * @returns {Promise<object|null>} розпарсений package.json або null
 */
async function readPkg(dir) {
  const path = join(dir, 'package.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Сканує монорепо: для кожного воркспейсу — чи є `start`, його команда і тип.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<Array<{workspace:string, name:string|null, hasStart:boolean, startCmd:string|null, type:('server'|'cli'|null)}>>} список воркспейсів
 */
export async function scanStartWorkspaces(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const out = []
  for (const ws of roots) {
    const pkg = await readPkg(join(cwd, ws))
    const startCmd = pkg?.scripts?.start ?? null
    const hasStart = typeof startCmd === 'string' && startCmd.length > 0
    out.push({
      workspace: ws,
      name: pkg?.name ?? null,
      hasStart,
      startCmd: hasStart ? startCmd : null,
      type: hasStart ? classifyStartType(startCmd) : null
    })
  }
  return out
}

/**
 * Парсить лог процесу: готовність (сервер), перша помилка, хвіст.
 * @param {string} log обʼєднаний stdout+stderr
 * @returns {{ready:boolean, firstError:string|null, logTail:string}} витяг
 */
export function parseStartLog(log = '') {
  const text = log
  const lines = text.split('\n')
  const firstError = lines.find(l => ERROR_RE.test(l))?.trim() ?? null
  const logTail = lines
    .filter(l => l.trim() !== '')
    .slice(-LOG_TAIL_LINES)
    .join('\n')
  return { ready: READY_RE.test(text), firstError, logTail }
}

/**
 * Read-only знімок `git status --porcelain` як множина рядків.
 * @param {string} cwd корінь репозиторію
 * @returns {Set<string>} рядки porcelain (статус + шлях)
 */
function gitPorcelain(cwd) {
  const res = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
  if (res.status !== 0 || typeof res.stdout !== 'string') return new Set()
  return new Set(res.stdout.split('\n').filter(l => l.trim() !== ''))
}

/**
 * Обчислює побічні ефекти прогону як різницю git-станів до/після.
 * @param {Set<string>} before знімок до
 * @param {Set<string>} after знімок після
 * @returns {{newFiles:string[], changedTracked:string[]}} нові untracked і ново-змінені tracked шляхи
 */
function diffSideEffects(before, after) {
  const newFiles = []
  const changedTracked = []
  for (const line of after) {
    if (before.has(line)) continue
    const path = line.slice(3)
    if (line.startsWith('??')) newFiles.push(path)
    else changedTracked.push(path)
  }
  return { newFiles, changedTracked }
}

/**
 * Запускає `start` одного воркспейсу з grace-таймаутом і класифікує результат.
 * @param {string} cwd корінь репозиторію
 * @param {string} workspace відносний шлях воркспейсу
 * @param {{graceMs?:number, type?:('server'|'cli'), spawnImpl?:Function}} [opts] grace-період, тип (інакше з package.json), інʼєкція spawn для тестів
 * @returns {Promise<{workspace:string, type:string, exitCode:number|null, timedOut:boolean, status:('OK'|'FAIL'), ready:boolean, firstError:string|null, logTail:string, sideEffects:{newFiles:string[], changedTracked:string[]}}>} результат прогону
 */
export async function runWorkspaceStart(cwd, workspace, opts = {}) {
  const { graceMs = 12_000, spawnImpl = spawnSync } = opts
  const dir = join(cwd, workspace)
  const pkg = await readPkg(dir)
  const startCmd = pkg?.scripts?.start
  if (typeof startCmd !== 'string' || startCmd.length === 0) {
    throw new Error(`У воркспейсі ${workspace} немає scripts.start`)
  }
  const type = opts.type ?? classifyStartType(startCmd)

  const before = gitPorcelain(cwd)
  const res = spawnImpl('bun', ['run', 'start'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: graceMs,
    killSignal: 'SIGTERM'
  })
  const timedOut = res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM'
  const exitCode = typeof res.status === 'number' ? res.status : null
  const { ready, firstError, logTail } = parseStartLog(`${res.stdout ?? ''}${res.stderr ?? ''}`)

  // server: успіх = дожив до кінця grace (timedOut) або встиг віддати рядок готовності.
  // cli: успіх = чистий вихід 0 у межах grace.
  let status
  if (type === 'server') status = timedOut || ready ? 'OK' : 'FAIL'
  else status = exitCode === 0 ? 'OK' : 'FAIL'

  return {
    workspace,
    type,
    exitCode,
    timedOut,
    status,
    ready,
    firstError,
    logTail,
    sideEffects: diffSideEffects(before, gitPorcelain(cwd))
  }
}

const USAGE = 'Usage: n-cursor start-check <scan | run <workspace> [--grace <ms>]>'

/**
 * CLI: `scan` друкує список воркспейсів зі `start`; `run <ws>` запускає один і
 * друкує класифікований результат. Обидва — JSON у stdout.
 * @param {string[]} args аргументи після `start-check`
 * @param {string} [cwd] корінь репозиторію (інʼєкція для тестів)
 * @returns {Promise<number>} exit code
 */
export async function runStartCheckCli(args, cwd = process.cwd()) {
  const sub = args[0]

  if (sub === 'scan') {
    process.stdout.write(`${JSON.stringify(await scanStartWorkspaces(cwd))}\n`)
    return 0
  }

  if (sub === 'run') {
    const workspace = args[1] && !args[1].startsWith('--') ? args[1] : undefined
    if (!workspace) {
      console.error(USAGE)
      return 1
    }
    const graceAt = args.indexOf('--grace')
    const graceMs = graceAt === -1 ? undefined : Number(args[graceAt + 1])
    if (graceAt !== -1 && (!Number.isFinite(graceMs) || graceMs <= 0)) {
      console.error('✗ --grace очікує додатнє число (мс)')
      return 1
    }
    try {
      const result = await runWorkspaceStart(cwd, workspace, graceMs ? { graceMs } : {})
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return 0
    } catch (error) {
      console.error(`✗ ${error.message}`)
      return 1
    }
  }

  console.error(USAGE)
  return 1
}
