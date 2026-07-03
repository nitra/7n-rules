/**
 * Глобальна черга запусків `n-cursor lint --full`: у кожен момент на машині
 * виконується щонайбільше один **full**-прогін, наступні чекають у черзі й
 * стартують після звільнення лока. Рішення spec-дискусії 2026-07-03 (ревізія):
 * лок береться **лише** на `--full` — дельта/scoped/`--no-fix` запуски короткі
 * й ідуть без черги; довгі whole-tree прогони серіалізуються та отримують
 * видимість: процес у черзі показує свою позицію, решту черги і живий
 * прогрес-бар активного прогону (читає його зі стан-файлу).
 * `hook --post-tool-use` лок не бере: read-only, per-file, відповідає миттєво.
 *
 * Механіка — наявний {@link withLock} (mkdir-лок, перехоплення лока мертвого PID,
 * poll-черга, TTL-дедуплікація за fingerprint) з відмінностями від per-rule
 * використання (`run-standard-lint.mjs`):
 *   - `cacheDir` у `os.tmpdir()` замість `<git-common-dir>` → скоуп machine-wide
 *     (на macOS tmpdir per-user), а не per-repo;
 *   - fingerprint дедуплікації домішує варіант виклику (rules/`--no-fix`/cwd) до
 *     знімка дерева — інакше scoped-успіх хибно пропускав би ширший прогін;
 *   - `staleThreshold` піднято до 6 год: дефолтні 30 хв «перехоплювали» б живий
 *     лок довгого прогону; краші покриває PID-перевірка;
 *   - `waitTimeout` 45 хв (full-прогони довгі), далі fail-closed (Error, exit 1),
 *     а не дефолтний `run-unlocked` — мовчазний паралельний запуск це саме те,
 *     що черга має унеможливити.
 *
 * Спільний стан у `GLOBAL_CACHE_DIR`:
 *   - `lock/owner.json` — власник лока (пише withLock; pid/cwd/startedAt);
 *   - `queue/<enqueuedAt>-<pid>.json` — реєстрація процесів у черзі (для списку);
 *   - `progress.json` — знімок прогресу активного прогону (пише publisher
 *     через `createProgressReporter({ onUpdate })`, читають процеси в черзі).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { isPidAlive, withLock } from '../../utils/with-lock.mjs'
import { worktreeFingerprint } from '../../utils/worktree-fingerprint.mjs'
import { renderProgressLine } from './progress.mjs'

/** Machine-wide директорія стану лока/черги — спільна для всіх репо й worktree. */
export const GLOBAL_CACHE_DIR = join(tmpdir(), 'n-cursor', 'lint-full')

const QUEUE_DIR = join(GLOBAL_CACHE_DIR, 'queue')
const PROGRESS_FILE = join(GLOBAL_CACHE_DIR, 'progress.json')

/** Дедлайн очікування в черзі: full-прогони довгі, 20 хв дефолту withLock замало. */
const WAIT_TIMEOUT_MS = 45 * 60_000

/** Поріг time-based staleness (див. модульний коментар). */
const STALE_THRESHOLD_MS = 6 * 3_600_000

/** Мінімальний інтервал між записами progress.json (не молотити диск на кожен tick). */
const PUBLISH_MIN_INTERVAL_MS = 500

/** Інтервал append-рядків черги в не-TTY режимі (CI/пайпи). */
const NON_TTY_WAIT_LOG_INTERVAL_MS = 10_000

/** Знімок прогресу вважається живим, якщо оновлювався не давніше за це. */
const PROGRESS_FRESH_MS = 60_000

/**
 * Fingerprint для TTL-дедуплікації: стан робочого дерева + варіант виклику lint.
 * null (→ дедуплікація вимкнена, черга працює) коли:
 *   - не в git-репо (worktreeFingerprint дасть null);
 *   - `--cwd` вказує не на процесний cwd — git-команди fingerprint-а виконуються
 *     у `process.cwd()`, тож знімок відповідав би не тому дереву, що лінтиться.
 * @param {{cwd: string, full: boolean, rules: string[], noFix: boolean}} variant осі виклику lint
 * @param {() => string | null} [getTreeFp] знімок дерева (ін'єкція для тестів)
 * @returns {string | null} sha256-hex або null, якщо дедуп не можна застосувати
 */
export function lintLockFingerprint(variant, getTreeFp = worktreeFingerprint) {
  if (variant.cwd !== processCwd()) return null
  const treeFp = getTreeFp()
  if (treeFp === null) return null
  const axes = { cwd: variant.cwd, full: variant.full, noFix: variant.noFix, rules: [...variant.rules].toSorted() }
  return createHash('sha256')
    .update(`${treeFp}\n${JSON.stringify(axes)}`)
    .digest('hex')
}

/**
 * Publisher прогресу активного прогону: приймає знімки від
 * `createProgressReporter({ onUpdate })` і (throttled) пише їх у стан-файл,
 * звідки процеси в черзі читають прогрес-бар активного прогону.
 * @param {{file?: string, minIntervalMs?: number}} [opts] override-и для тестів
 * @returns {{ onUpdate: (snap: { done: number, total: number, found: number, fixed: number, current: string }) => void, stop: () => void }} publisher
 */
export function createProgressPublisher(opts = {}) {
  const file = opts.file ?? PROGRESS_FILE
  const minIntervalMs = opts.minIntervalMs ?? PUBLISH_MIN_INTERVAL_MS
  let lastWriteAt = 0
  return {
    onUpdate: snap => {
      const now = Date.now()
      if (now - lastWriteAt < minIntervalMs) return
      lastWriteAt = now
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify({ pid: process.pid, updatedAt: now, cwd: processCwd(), ...snap }))
      } catch {
        // best-effort: без стан-файлу процеси в черзі просто не побачать бар
      }
    },
    stop: () => {
      try {
        rmSync(file, { force: true })
      } catch {
        // best-effort: застарілий файл відфільтрує PROGRESS_FRESH_MS/pid-перевірка
      }
    }
  }
}

/**
 * Список живих учасників черги у порядку постановки. Записи мертвих PID
 * прибираються по дорозі (best-effort).
 * @param {string} queueDir директорія реєстрацій черги
 * @returns {Array<{ pid: number, cwd: string, enqueuedAt: number }>} черга
 */
function listQueue(queueDir) {
  /** @type {Array<{ pid: number, cwd: string, enqueuedAt: number }>} */
  const entries = []
  let names
  try {
    names = readdirSync(queueDir)
  } catch {
    return entries
  }
  for (const name of names) {
    const path = join(queueDir, name)
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof entry?.pid === 'number' && isPidAlive(entry.pid)) {
        entries.push(entry)
      } else {
        rmSync(path, { force: true })
      }
    } catch {
      rmSync(path, { force: true })
    }
  }
  return entries.toSorted((a, b) => a.enqueuedAt - b.enqueuedAt)
}

/**
 * Читає знімок прогресу активного прогону; null, якщо файла нема, він
 * застарілий або належить не поточному власнику лока.
 * @param {number} ownerPid PID власника лока
 * @param {string} progressFile шлях стан-файлу прогресу
 * @returns {{ done: number, total: number, found: number, fixed: number, current: string } | null} знімок
 */
function readOwnerProgress(ownerPid, progressFile) {
  try {
    const snap = JSON.parse(readFileSync(progressFile, 'utf8'))
    if (snap?.pid !== ownerPid) return null
    if (Date.now() - snap.updatedAt > PROGRESS_FRESH_MS) return null
    return snap
  } catch {
    return null
  }
}

/**
 * Рядок стану черги для процесу, що стоїть у черзі: позиція, хто працює (pid + тека),
 * прогрес-бар власника і перелік решти черги.
 * @param {{ pid: number, cwd?: string }} owner власник лока (owner.json)
 * @param {Array<{ pid: number, cwd: string }>} queue живі учасники черги (у порядку постановки)
 * @param {{ done: number, total: number, found: number, fixed: number, current: string } | null} snap знімок прогресу власника
 * @returns {string} однорядковий стан черги (без завершального \n)
 */
export function renderWaitLine(owner, queue, snap) {
  const myIdx = queue.findIndex(e => e.pid === process.pid)
  const pos = (myIdx === -1 ? queue.length : myIdx) + 1
  const ownerDir = owner.cwd ? ` (${basename(owner.cwd)})` : ''
  const bar = snap ? ` · ${renderProgressLine(snap)}` : ''
  const others = queue
    .filter(e => e.pid !== process.pid)
    .map(e => `pid ${e.pid} (${basename(e.cwd)})`)
    .join(', ')
  const tail = others ? ` · чекають: ${others}` : ''
  return `⏳ lint --full у черзі #${pos}/${Math.max(queue.length, pos)} · працює pid ${owner.pid}${ownerDir}${bar}${tail}`
}

/**
 * UI очікування для хуків withLock: реєструє процес у черзі, на кожен tick
 * рендерить рядок стану (TTY — перемальовування одного рядка на stderr;
 * не-TTY — append раз на {@link NON_TTY_WAIT_LOG_INTERVAL_MS}), по завершенню
 * прибирає реєстрацію і чистить рядок.
 * @param {{ isTTY?: boolean, log?: (s: string) => void, queueDir?: string, progressFile?: string }} [opts] override-и для тестів
 * @returns {{ onWaitStart: (owner: object) => void, onWaitTick: (owner: object) => void, onWaitEnd: () => void }} хуки
 */
function createWaitUi(opts = {}) {
  const isTTY = opts.isTTY ?? process.stderr.isTTY === true
  const log = opts.log ?? (s => process.stderr.write(s))
  const queueDir = opts.queueDir ?? QUEUE_DIR
  const progressFile = opts.progressFile ?? PROGRESS_FILE
  const queueFile = join(queueDir, `${Date.now()}-${process.pid}.json`)
  let lastAppendAt = 0

  return {
    onWaitStart: () => {
      try {
        mkdirSync(queueDir, { recursive: true })
        writeFileSync(queueFile, JSON.stringify({ pid: process.pid, cwd: processCwd(), enqueuedAt: Date.now() }))
      } catch {
        // best-effort: без реєстрації процес просто не видно у списку черги
      }
    },
    onWaitTick: owner => {
      const line = renderWaitLine(owner, listQueue(queueDir), readOwnerProgress(owner.pid, progressFile))
      if (isTTY) {
        // \r + ANSI clear-line: один рядок, що перемальовується на кожен tick
        log(`\r\u{1B}[2K${line}`)
      } else if (Date.now() - lastAppendAt >= NON_TTY_WAIT_LOG_INTERVAL_MS) {
        lastAppendAt = Date.now()
        log(`${line}\n`)
      }
    },
    onWaitEnd: () => {
      rmSync(queueFile, { force: true })
      if (isTTY) log('\r\u{1B}[2K')
    }
  }
}

/**
 * Виконує `runFn` під глобальним локом full-прогонів. Не-full варіанти
 * (дельта/scoped/`--no-fix`) виконуються одразу, без лока й черги.
 * @param {{cwd: string, full: boolean, rules: string[], noFix: boolean}} variant осі виклику lint
 * @param {() => number | Promise<number>} runFn реальна робота lint; повертає exit code
 * @param {{ttl?: number, staleThreshold?: number, waitTimeout?: number, pollInterval?: number, cacheDir?: string, getFingerprint?: () => string | null, isTTY?: boolean, log?: (s: string) => void, queueDir?: string, progressFile?: string}} [opts] override-и `withLock`/UI (для тестів)
 * @returns {Promise<number>} exit code виконаного запуску (або 0 при дедуплікації)
 */
export function withGlobalLintLock(variant, runFn, opts = {}) {
  if (!variant.full) return Promise.resolve(runFn())
  const { isTTY, log, queueDir, progressFile, ...lockOpts } = opts
  const ui = createWaitUi({ isTTY, log, queueDir, progressFile })
  return withLock('lint-full', runFn, {
    cacheDir: GLOBAL_CACHE_DIR,
    staleThreshold: STALE_THRESHOLD_MS,
    waitTimeout: WAIT_TIMEOUT_MS,
    onWaitTimeout: 'fail',
    getFingerprint: () => lintLockFingerprint(variant),
    ...ui,
    ...lockOpts
  })
}
