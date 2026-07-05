/** @see ./docs/fix-internal_urls.md */

/**
 * T0-autofix для `hasura/internal_urls` — виправляє лише детерміновані розбіжності
 * `service`/`namespace` у вже валідному внутрішньому кластерному URL проти
 * `hasura/k8s/base/{svc-hl,namespace}.yaml` (переписує сегменти, зберігаючи `cluster`/`port`
 * з наявного значення). Структурно невалідний URL (`internal-url-invalid`) — НЕ T0-фікс:
 * `cluster`/`port` нізвідки достовірно вивести, це людське рішення про інфраструктуру.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { HASURA_ENDPOINT_LINE_RE, computeExpectedEndpointSegments, parseInternalHasuraEndpoint } from './main.mjs'

const MISMATCH_REASONS = new Set(['internal-url-service-mismatch', 'internal-url-namespace-mismatch'])

/**
 * Переписує значення `HASURA_GRAPHQL_ENDPOINT` у файлі на очікувані `service`/`namespace`.
 * @param {string} absPath абсолютний шлях `.env`
 * @param {{ service: string | null, namespace: string | null }} expected очікувані сегменти
 * @returns {Promise<boolean>} true — якщо файл змінено
 */
async function rewriteEndpoint(absPath, expected) {
  const content = await readFile(absPath, 'utf8')
  const m = content.match(HASURA_ENDPOINT_LINE_RE)
  if (!m) return false

  const raw = m[1]
  const parsed = parseInternalHasuraEndpoint(raw.trim())
  if (!parsed.ok) return false

  const service = expected.service ?? parsed.service
  const namespace = expected.namespace ?? parsed.namespace
  const nextValue = `http://${service}.${namespace}.svc.${parsed.cluster}.internal:${parsed.port}`
  if (nextValue === raw.trim()) return false

  const rawStart = m.index + m[0].indexOf(raw)
  const nextContent = content.slice(0, rawStart) + nextValue + content.slice(rawStart + raw.length)
  await writeFile(absPath, nextContent, 'utf8')
  return true
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'hasura-internal-url-mismatch',
    test: violations => violations.some(v => MISMATCH_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const expected = await computeExpectedEndpointSegments(ctx.cwd)
      const files = [...new Set(violations.filter(v => MISMATCH_REASONS.has(v.reason) && v.file).map(v => v.file))]

      const touchedFiles = []
      for (const rel of files) {
        const absPath = join(ctx.cwd, rel)
        if (await rewriteEndpoint(absPath, expected)) {
          ctx.recordWrite?.(absPath)
          touchedFiles.push(absPath)
        }
      }

      return touchedFiles.length > 0
        ? { touchedFiles, message: `HASURA_GRAPHQL_ENDPOINT: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
