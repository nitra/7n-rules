/**
 * Надає спільні deterministic primitives для package-knowledge core.
 *
 * Усі graph/cache consumers використовують однакове рекурсивне впорядкування
 * JSON, prefixed SHA-256 і fail-closed versioned cache contract.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Рекурсивно стабілізує object keys для byte-stable JSON.
 * @param {unknown} value JSON-подібне значення
 * @returns {unknown} canonical copy
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(item => canonicalize(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  )
}

/**
 * Створює prefixed SHA-256 для canonical JSON-подібного значення.
 * @param {unknown} value stable input
 * @returns {string} `sha256:` digest
 */
export function canonicalHash(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`
}

/**
 * Відкриває injected або durable successful-result cache заданої версії.
 * @param {string | null | undefined} cachePath optional durable cache path
 * @param {{version?: number, entries?: Record<string, unknown>} | undefined} suppliedCache injectable cache
 * @param {number} version required cache schema version
 * @returns {Promise<{version: number, entries: Record<string, unknown>}>} normalized cache
 */
export async function loadVersionedCache(cachePath, suppliedCache, version) {
  if (suppliedCache) {
    if (!suppliedCache.entries || typeof suppliedCache.entries !== 'object' || Array.isArray(suppliedCache.entries)) {
      suppliedCache.entries = {}
    }
    suppliedCache.version = version
    return suppliedCache
  }
  if (!cachePath) return { version, entries: {} }
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'))
    if (
      parsed?.version === version &&
      parsed.entries &&
      typeof parsed.entries === 'object' &&
      !Array.isArray(parsed.entries)
    ) {
      return { version, entries: parsed.entries }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { version, entries: {} }
}

/**
 * Atomically persists only the supplied canonical successful-result cache.
 * @param {string | null | undefined} cachePath optional durable cache path
 * @param {{version: number, entries: Record<string, unknown>}} cache cache state
 * @returns {Promise<void>} completion
 */
export async function saveVersionedCache(cachePath, cache) {
  if (!cachePath) return
  await mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(canonicalize(cache))}\n`, 'utf8')
  await rename(temporaryPath, cachePath)
}
