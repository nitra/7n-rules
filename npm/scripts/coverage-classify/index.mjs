/**
 * Public API класифікатора: classify(survived, cwd, opts) → verdicts[]
 *
 * Routing:
 *   1. Cache lookup → hit → використати збережений verdict.
 *   2. Cache miss → Tier 1 (resolveModel('min')) → parseVerdict.
 *   3. Tier 1 fail (model error / bad JSON / Zod) → Tier 2 (CLOUD_MIN через pi).
 *   4. Tier 2 fail → conservative fallback worth-testing/confidence=0.
 *
 * Бекенд обирається за model-id: `omlx/...` → прямий HTTP до omlx (локально),
 * решта → pi CLI. Якщо omlx-Tier 1 недоступний, помилка падає в той самий catch
 * і класифікація відкочується на хмарний Tier 2 через pi.
 */
import { join } from 'node:path'

import { CLOUD_MIN, resolveModel } from '../../lib/models.mjs'
import { callLlm } from '../../lib/llm.mjs'
import { deriveCacheKey, readCache, writeCache } from './cache.mjs'
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.mjs'
import { parseVerdict } from './verdict-schema.mjs'

const FALLBACK_VERDICT = {
  verdict: 'worth-testing',
  confidence: 0,
  reason: 'LLM-classification unavailable, conservative fallback (treat as worth-testing)'
}

/**
 * Викликає LLM через спільний `callLlm` (маршрут за префіксом model-id; wire-trace).
 * @param {string} prompt текст промпта
 * @param {string} model  provider/model-id, `omlx/...` або '' для pi-дефолту
 * @returns {string} текст відповіді моделі
 * @throws {Error} якщо backend недоступний або повертає помилку
 */
function callModel(prompt, model) {
  return callLlm([{ role: 'user', content: prompt }], model, { timeoutMs: 60_000, caller: 'coverage' })
}

/**
 * Два тири: LOCAL_MIN → Tier 2 CLOUD_MIN → FALLBACK_VERDICT.
 * @param {{file: string, mutants: object[]}} group група мутантів одного файлу
 * @param {object} mutant конкретний мутант
 * @param {string} cwd корінь проєкту
 * @param {(prompt: string, model: string) => string} callModelFn  ін'єкція для тестів
 * @returns {object} verdict класифікації
 */
function classifyOne(group, mutant, cwd, callModelFn) {
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt({ ...mutant, file: group.file }, cwd)}`
  const loc = `${group.file}:${mutant.line}:${mutant.col}`

  // Tier 1: resolveModel('min') — каскад local→cloud якщо локалі нема
  try {
    const text = callModelFn(prompt, resolveModel('min'))
    return parseVerdict(text)
  } catch {
    // Tier 2: CLOUD_MIN
    try {
      const text = callModelFn(prompt, CLOUD_MIN)
      return parseVerdict(text)
    } catch (error) {
      console.warn(`⚠ coverage classify: ${loc} both tiers failed: ${error.message}`)
      return { ...FALLBACK_VERDICT }
    }
  }
}

/**
 * Класифікує survived мутантів (resolveModel('min') → CLOUD_MIN → fallback).
 * @param {Array<{file: string, mutants: object[], exampleTest?: object|null, recommendationText?: string|null}>} survived список вцілілих мутантів
 * @param {string} cwd корінь проєкту
 * @param {{cachePath?: string, callModel?: (prompt: string, model: string) => string}} [opts] ін'єкції для тестів
 * @returns {Promise<Array<{key: string, verdict: object}>>} verdicts
 */
export function classify(survived, cwd, opts = {}) {
  const cachePath = opts.cachePath ?? join(cwd, 'npm/reports/coverage-classify.cache.json')
  const callModelFn = opts.callModel ?? callModel
  const cacheModel = `${resolveModel('min') || 'default'}+${CLOUD_MIN || 'cloud'}`

  const cache = readCache(cachePath)
  if (cache.model !== cacheModel) {
    cache.entries = {}
    cache.model = cacheModel
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
        verdict = classifyOne(group, mutant, cwd, callModelFn)
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
