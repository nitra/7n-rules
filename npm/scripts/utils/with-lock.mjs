/**
 * Guard-механізм: атомарний lock + dedup для важких команд.
 * Алгоритм: mkdirSync-based lock, перевірка живості PID, sha256-dedup з TTL.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { worktreeFingerprint } from './worktree-fingerprint.mjs'

const DEFAULTS = {
  ttl: 600_000,
  staleThreshold: 1_800_000,
  waitTimeout: 1_200_000,
  pollInterval: 1_500,
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function makeRelease(lockDir) {
  return () => fs.rmSync(lockDir, { recursive: true, force: true })
}

/**
 * @param {{exitCode:number, fingerprint:string|null, finishedAt:number}} result
 * @param {string|null} fingerprint
 * @param {number} ttl
 */
export function shouldDedup(result, fingerprint, ttl) {
  if (result.exitCode !== 0) return false
  if (fingerprint === null || result.fingerprint !== fingerprint) return false
  if (Date.now() - result.finishedAt >= ttl) return false
  return true
}

/**
 * @param {string} key
 * @param {() => number | Promise<number>} runFn
 * @param {{ttl?:number, staleThreshold?:number, waitTimeout?:number, pollInterval?:number, cacheDir?:string, getFingerprint?:() => string | null}} [opts]
 * @returns {Promise<number>}
 */
export async function withLock(key, runFn, opts = {}) {
  const { ttl, staleThreshold, waitTimeout, pollInterval } = { ...DEFAULTS, ...opts }
  const getFingerprint = opts.getFingerprint ?? worktreeFingerprint
  const cacheDir = opts.cacheDir ?? path.join(process.cwd(), 'node_modules/.cache/n-cursor', key)
  const lockDir = path.join(cacheDir, 'lock')
  const ownerFile = path.join(lockDir, 'owner.json')
  const resultFile = path.join(cacheDir, 'result.json')
  const release = makeRelease(lockDir)

  const fingerprint = getFingerprint()
  fs.mkdirSync(cacheDir, { recursive: true })

  const loopStart = Date.now()
  let locked = false

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - loopStart >= waitTimeout) {
      console.error(`⚠️ ${key}: чекав ${waitTimeout / 60_000} хв — запускаю без локу`)
      return await runFn()
    }
    try {
      fs.mkdirSync(lockDir)
      fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: Date.now(), fingerprint }))
      locked = true
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner
      try { owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')) } catch {
        fs.rmSync(lockDir, { recursive: true, force: true })
        continue
      }
      const stale = (Date.now() - owner.startedAt > staleThreshold) ||
        (os.hostname() === owner.host && !isAlive(owner.pid))
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
  } catch { /* result.json не існує або пошкоджений */ }

  const onSignal = () => { release(); process.exit(130) }
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
