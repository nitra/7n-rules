/**
 * NNN-лічильники — рахують існуючі файли певного патерну і повертають наступний NNN.
 * Zero-padded до 3 цифр: 001, 002, …
 */
import { readdirSync } from 'node:fs'

/**
 * @param {string} dir абсолютний шлях до директорії вузла
 * @param {RegExp} pattern регексп для імен файлів (напр. /^run_(\d{3})\.md$/)
 * @returns {number} кількість файлів що підходять
 */
export function countFiles(dir, pattern) {
  try {
    return readdirSync(dir).filter(f => pattern.test(f)).length
  } catch {
    return 0
  }
}

/**
 * @param {string} dir
 * @returns {string} наступний NNN для run_NNN.md (zero-padded)
 */
export function nextRunNNN(dir) {
  const count = countFiles(dir, /^run_\d{3}\.md$/u)
  return String(count + 1).padStart(3, '0')
}

/**
 * @param {string} dir
 * @returns {string} наступний NNN для plan_NNN.md (zero-padded)
 */
export function nextPlanNNN(dir) {
  const count = countFiles(dir, /^plan_\d{3}\.md$/u)
  return String(count + 1).padStart(3, '0')
}

/**
 * Знаходить NNN останнього fact_NNN.md.
 * @param {string} dir
 * @returns {string | null}
 */
export function latestFactNNN(dir) {
  try {
    const files = readdirSync(dir)
      .filter(f => /^fact_\d{3}\.md$/u.test(f))
      .sort()
    if (files.length === 0) return null
    return files.at(-1).replace('fact_', '').replace('.md', '')
  } catch {
    return null
  }
}

/**
 * Знаходить NNN pending-audit без відповідного audit-result.
 * @param {string} dir
 * @returns {string | null}
 */
export function pendingAuditNNN(dir) {
  try {
    const files = readdirSync(dir)
    const pending = files.filter(f => /^pending-audit_\d{3}\.md$/u.test(f)).sort()
    for (const p of pending) {
      const nnn = p.replace('pending-audit_', '').replace('.md', '')
      if (!files.includes(`audit-result_${nnn}.md`)) return nnn
    }
    return null
  } catch {
    return null
  }
}

/** @param {number} n @returns {string} */
export function pad3(n) {
  return String(n).padStart(3, '0')
}
