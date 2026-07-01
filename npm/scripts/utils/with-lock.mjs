/**
 * Guard-механізм: атомарний lock + dedup для важких команд.
 * Алгоритм: mkdirSync-based lock, перевірка живості PID, sha256-dedup з TTL.
 */
import * as fs from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolveLockCacheDir } from './lock-cache-dir.mjs'
import { worktreeFingerprint } from './worktree-fingerprint.mjs'

const DEFAULTS = {
  ttl: 600_000,
  staleThreshold: 1_800_000,
  waitTimeout: 1_200_000,
  pollInterval: 1500,
  onWaitTimeout: 'run-unlocked'
}

/**
 * Чи процес із заданим PID ще живий на поточному host.
 * @param {number} pid ідентифікатор процесу з owner.json
 * @returns {boolean} true, якщо process.kill(pid, 0) не кинув помилку
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Повертає функцію, що знімає lock-директорію.
 * @param {string} lockDir абсолютний шлях до lock-директорії
 * @returns {() => void} release-колбек для finally/signal handler
 */
function makeRelease(lockDir) {
  return () => fs.rmSync(lockDir, { recursive: true, force: true })
}

/**
 * Чи можна пропустити повторний прогін за кешованим result.json.
 * @param {{exitCode:number, fingerprint:string|null, finishedAt:number}} result попередній результат з result.json
 * @param {string|null} fingerprint поточний fingerprint робочого дерева
 * @param {number} ttl TTL дедуплікації в мілісекундах
 * @returns {boolean} true, якщо попередній успішний прогін можна повторно використати
 */
export function shouldDedup(result, fingerprint, ttl) {
  if (result.exitCode !== 0) return false
  if (fingerprint === null || result.fingerprint !== fingerprint) return false
  return Date.now() - result.finishedAt < ttl
}

/**
 * Серіалізує важку команду через атомарний lock і dedup за fingerprint.
 * @param {string} key ключ локу (наприклад `lint-ga`, `fix-bun`)
 * @param {() => number | Promise<number>} runFn основна робота; повертає exit code
 * @param {{ttl?:number, staleThreshold?:number, waitTimeout?:number, pollInterval?:number, onWaitTimeout?:'run-unlocked'|'fail', cacheDir?:string, getFingerprint?:() => string | null}} [opts] TTL, шлях кешу, поведінка на таймаут (default `run-unlocked`; `fail` = fail-closed) та override fingerprint
 * @returns {Promise<number>} exit code виконаної або дедуплікованої команди
 */
export async function withLock(key, runFn, opts = {}) {
  const { ttl, staleThreshold, waitTimeout, pollInterval, onWaitTimeout } = { ...DEFAULTS, ...opts }
  const getFingerprint = opts.getFingerprint ?? worktreeFingerprint
  const cacheDir = opts.cacheDir ?? resolveLockCacheDir(key)
  const lockDir = join(cacheDir, 'lock')
  const ownerFile = join(lockDir, 'owner.json')
  const resultFile = join(cacheDir, 'result.json')
  const release = makeRelease(lockDir)

  const fingerprint = getFingerprint()
  fs.mkdirSync(cacheDir, { recursive: true })

  const loopStart = Date.now()

  while (true) {
    if (Date.now() - loopStart >= waitTimeout) {
      if (onWaitTimeout === 'fail') {
        throw new Error(`${key}: не вдалося взяти лок за ${waitTimeout / 60_000} хв — fail-closed`)
      }
      console.error(`⚠️ ${key}: чекав ${waitTimeout / 60_000} хв — запускаю без локу`)
      return await runFn()
    }
    try {
      fs.mkdirSync(lockDir)
      fs.writeFileSync(
        ownerFile,
        JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: Date.now(), fingerprint })
      )
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner
      try {
        owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
      } catch {
        fs.rmSync(lockDir, { recursive: true, force: true })
        continue
      }
      const stale =
        Date.now() - owner.startedAt > staleThreshold || (os.hostname() === owner.host && !isAlive(owner.pid))
      if (stale) {
        console.error(`🧹 ${key}: знайдено застарілий лок — очищаю`)
        fs.rmSync(lockDir, { recursive: true, force: true })
        continue
      }
      console.error(`⏳ ${key}: чекаю, лок тримає pid ${owner.pid}…`)
      await sleep(pollInterval)
    }
  }

  console.error(`🔒 ${key}: лок взято`)

  try {
    const raw = fs.readFileSync(resultFile, 'utf8')
    const result = JSON.parse(raw)
    if (shouldDedup(result, fingerprint, ttl)) {
      const elapsed = Math.round((Date.now() - result.finishedAt) / 1000)
      console.error(`♻️ ${key}: те саме дерево, ${elapsed}с тому — пропускаю`)
      release()
      return 0
    }
  } catch {
    /* result.json не існує або пошкоджений */
  }

  // Після release лок ре-рейзиться той самий сигнал: `once` вже зняв обробник,
  // тож процес завершується дефолтною дією з коректним кодом (130/143)
  const onSignal = signal => {
    release()
    process.kill(process.pid, signal)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let code
  try {
    code = await runFn()
    fs.writeFileSync(resultFile, JSON.stringify({ finishedAt: Date.now(), exitCode: code, fingerprint }))
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    release()
  }

  return code
}
