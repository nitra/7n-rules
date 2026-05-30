/**
 * File-hash-keyed cache для coverage-classify verdicts.
 *
 * Cache key = `<blob-hash>:<line>:<col>:<base64url(replacement)>`.
 * Blob hash рахуємо через `git hash-object <file>` (детерміновано на working tree)
 * з fallback на sha1(readFile) якщо git недоступний.
 *
 * Cache schema:
 *   { version: 1, model: string|null, entries: Record<key, { verdict, confidence, reason, suggestedTest?, classifiedAt }> }
 *
 * Інвалідація: будь-яка зміна source → новий blob-hash → cache miss → re-classify.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CACHE_VERSION = 1

/**
 * Хеш контенту файла (sha1, 40 hex chars). Спочатку `git hash-object`,
 * інакше sha1 контенту.
 * @param {string} filePath абсолютний шлях до файла
 * @returns {string | null} 40-char hex hash або null якщо файл недоступний
 */
export function deriveBlobHash(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return execFileSync('git', ['hash-object', filePath], { encoding: 'utf8' }).trim()
  } catch {
    const content = readFileSync(filePath)
    return createHash('sha1').update(content).digest('hex')
  }
}

/**
 * Cache-ключ для конкретного мутанта в конкретному стані файла.
 * @param {string} filePath абсолютний шлях до source файла
 * @param {{line: number, col: number, replacement: string}} mutant параметри мутанта
 * @returns {string | null} ключ або null якщо файл недоступний
 */
export function deriveCacheKey(filePath, mutant) {
  const blobHash = deriveBlobHash(filePath)
  if (!blobHash) return null
  const replacement = Buffer.from(mutant.replacement, 'utf8').toString('base64url')
  return `${blobHash}:${mutant.line}:${mutant.col}:${replacement}`
}

/**
 * Читає cache з диска. При будь-якій проблемі (file absent, corrupt JSON,
 * schema/version mismatch, entries не object) — повертає empty cache.
 * @param {string} cachePath абсолютний шлях до cache.json
 * @returns {{version: number, model: string|null, entries: Record<string, object>}} cache
 */
export function readCache(cachePath) {
  const empty = { version: CACHE_VERSION, model: null, entries: {} }
  if (!existsSync(cachePath)) return empty
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (data?.version !== CACHE_VERSION) return empty
    if (!data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) return empty
    return data
  } catch {
    return empty
  }
}

/**
 * Записує cache на диск. Створює батьківські директорії.
 * @param {string} cachePath абсолютний шлях
 * @param {{version: number, model: string|null, entries: Record<string, object>}} cache cache-об'єкт
 * @returns {void}
 */
export function writeCache(cachePath, cache) {
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}
