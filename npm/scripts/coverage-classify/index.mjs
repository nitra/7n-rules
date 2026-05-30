/**
 * Public API класифікатора: classify(survived, cwd, opts) → verdicts[]
 *
 * Orchestration:
 *   1. Перевірка ANTHROPIC_API_KEY + dynamic import SDK (graceful skip).
 *   2. Для кожного мутанта: cache lookup → класифікація → cache write.
 *   3. На неуспішну класифікацію після retries — conservative fallback worth-testing/confidence=0.
 *
 * Prompt caching: system-prompt передається з cache_control: ephemeral —
 * усі мутанти одного прогону reuse кешований префікс на стороні API.
 */
import { join } from 'node:path'
import { env } from 'node:process'
import { setTimeout } from 'node:timers/promises'

import { deriveCacheKey, readCache, writeCache } from './cache.mjs'
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.mjs'
import { parseVerdict } from './verdict-schema.mjs'

const MODEL = 'claude-sonnet-4-6'
const MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 1000

const FALLBACK_VERDICT = {
  verdict: 'worth-testing',
  confidence: 0,
  reason: 'LLM-classification unavailable, conservative fallback (treat as worth-testing)'
}

/**
 * Класифікує survived мутантів через Claude API.
 * Без API key / без SDK / при критичних помилках — повертає [] (graceful skip).
 * @param {Array<{file: string, mutants: Array<object>, exampleTest?: object|null, recommendationText?: string|null}>} survived список survived груп (як у COVERAGE.md)
 * @param {string} cwd корінь проєкту
 * @param {{cachePath?: string, client?: object, retryDelayMs?: number}} [opts] ін'єкції для тестів
 * @returns {Promise<Array<{key: string, verdict: object}>>} verdicts
 */
export async function classify(survived, cwd, opts = {}) {
  const cachePath = opts.cachePath ?? join(cwd, 'npm/reports/coverage-classify.cache.json')
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  if (!env.ANTHROPIC_API_KEY) {
    console.warn('⚠ coverage classify: ANTHROPIC_API_KEY not set, classification skipped')
    return []
  }

  let SDK
  try {
    SDK = await import('@anthropic-ai/sdk')
  } catch {
    console.warn('⚠ coverage classify: @anthropic-ai/sdk not installed, classification skipped')
    return []
  }
  const Anthropic = SDK.default
  const client = opts.client ?? new Anthropic()

  const cache = readCache(cachePath)
  if (cache.model !== MODEL) {
    cache.entries = {}
    cache.model = MODEL
  }

  const verdicts = []
  for (const group of survived) {
    for (const mutant of group.mutants) {
      const lookupKey = `${group.file}:${mutant.line}:${mutant.col}:${mutant.replacement}`
      const cacheKey = deriveCacheKey(join(cwd, group.file), mutant)

      let verdict = null
      if (cacheKey && cache.entries[cacheKey]) {
        const cached = cache.entries[cacheKey]
        verdict = {
          verdict: cached.verdict,
          confidence: cached.confidence,
          reason: cached.reason,
          ...(cached.suggestedTest ? { suggestedTest: cached.suggestedTest } : {})
        }
      }
      if (!verdict) {
        verdict = await classifyOne(client, group, mutant, cwd, retryDelayMs)
        if (cacheKey) {
          cache.entries[cacheKey] = { ...verdict, classifiedAt: new Date().toISOString() }
        }
      }

      verdicts.push({ key: lookupKey, verdict })
    }
  }

  writeCache(cachePath, cache)
  return verdicts
}

/**
 * Один виклик API з retry. На фейл після MAX_RETRIES — повертає FALLBACK_VERDICT.
 * @param {{messages: {create: Function}}} client SDK client
 * @param {{file: string}} group group для контексту
 * @param {object} mutant mutant data
 * @param {string} cwd корінь
 * @param {number} retryDelayMs base delay для exp-backoff (0 у тестах)
 * @returns {Promise<object>} verdict (parsed або fallback)
 */
async function classifyOne(client, group, mutant, cwd, retryDelayMs) {
  const userPrompt = buildUserPrompt({ ...mutant, file: group.file }, cwd)
  let lastError = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }]
      })
      const text = response?.content?.[0]?.text ?? ''
      return parseVerdict(text)
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES && retryDelayMs > 0) {
        await setTimeout(retryDelayMs * 2 ** attempt)
      }
    }
  }

  console.warn(
    `⚠ coverage classify: ${group.file}:${mutant.line}:${mutant.col} failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown'}`
  )
  return { ...FALLBACK_VERDICT }
}
