/**
 * Public API класифікатора: classify(survived, cwd, opts) → verdicts[]
 *
 * Batch-шлях (уніфікація на `@7n/llm-lib/batch`, спека
 * `docs/specs/2026-07-27-batch-local-avg-real-batches.md`, кластер E):
 *   1. Cache lookup для КОЖНОГО мутанта — hit → готовий verdict, без LLM.
 *   2. Cache-miss мутанти йдуть ОДНИМ `submitBatch`-викликом на tier1
 *      (`N_LOCAL_MIN_MODEL`) замість послідовного `for`-циклу.
 *   3. Ті, чию tier1-відповідь не вдалось розпарсити (чи сам виклик хвилі впав) —
 *      ДРУГА хвиля на tier2 (`N_CLOUD_MIN_MODEL`).
 *   4. Ще live-провали після tier2 → conservative fallback-вердикт.
 * Порядок повернення — вхідний порядок `survived`, незалежно від порядку
 * завершення items усередині batch-виклику.
 */
import { join } from 'node:path'

import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'
import { defaultLocalProviders } from '@7n/llm-lib/local-providers'
import { resolveModel } from '@7n/llm-lib/model-tiers'
import { deriveCacheKey, readCache, writeCache } from './cache.mjs'
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.mjs'
import { parseVerdict } from './verdict-schema.mjs'

const FALLBACK_VERDICT = {
  verdict: 'worth-testing',
  confidence: 0,
  reason: 'LLM-classification unavailable, conservative fallback (treat as worth-testing)'
}

/**
 * Один item черги класифікації — усе потрібне для промпта, кешування й
 * зіставлення результату batch-хвилі назад із мутантом (`lookupKey`
 * унікальний у межах виклику, слугує і за `customId` batch-item-у).
 * @typedef {{ lookupKey: string, cacheKey: string|null, prompt: string }} PendingItem
 */

/**
 * Готує чергу класифікації: розділяє мутантів на готові (cache hit,
 * `verdicts`) і ті, що потребують LLM (`pending`, з уже зібраним промптом —
 * SYSTEM_PROMPT + buildUserPrompt в одному user-повідомленні, той самий
 * формат, що й попередній послідовний виклик).
 * @param {Array<{file: string, mutants: object[]}>} survived survived-мутанти, згруповані по файлах
 * @param {string} cwd корінь проєкту
 * @param {{version: number, model: string|null, entries: Record<string, object>}} cache прочитаний кеш
 * @returns {{ verdicts: Array<{key: string, verdict: object}>, pending: PendingItem[] }} готові вердикти й черга на класифікацію
 */
function prepareQueue(survived, cwd, cache) {
  const verdicts = []
  const pending = []
  for (const group of survived) {
    for (const mutant of group.mutants) {
      const lookupKey = `${group.file}:${mutant.line}:${mutant.col}:${mutant.replacement}`
      const cacheKey = deriveCacheKey(join(cwd, group.file), mutant)

      if (cacheKey && cache.entries[cacheKey]) {
        const cached = cache.entries[cacheKey]
        verdicts.push({
          key: lookupKey,
          verdict: {
            verdict: cached.verdict,
            confidence: cached.confidence,
            reason: cached.reason,
            ...(cached.suggestedTest && { suggestedTest: cached.suggestedTest })
          }
        })
        continue
      }

      const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt({ ...mutant, file: group.file }, cwd)}`
      pending.push({ lookupKey, cacheKey, prompt })
      verdicts.push({ key: lookupKey, verdict: null }) // місце-заповнювач, заповнюється після хвиль
    }
  }
  return { verdicts, pending }
}

/**
 * Одна batch-хвиля: `submitBatch(model, items)` на всі `items` разом. Провал
 * САМОГО виклику хвилі (напр. невалідний model-spec) — не кидає далі, а
 * повертає порожню мапу: викликач трактує це як "усі items цієї хвилі
 * невдалі" і йде до наступного тиру/fallback, той самий graceful-degradation
 * принцип, що й у послідовному `classifyOne` (жодна конфігураційна проблема
 * моделі не валить весь вимір).
 * @param {PendingItem[]} items items хвилі
 * @param {string} model model-spec (tier1/tier2) — порожній рядок пропускає хвилю без мережевого виклику
 * @param {object} localProviders конфіг локальних провайдерів
 * @param {(model: string, items: Array<object>, opts?: object) => Promise<Array<object>>} submitBatchImpl injectable submitBatch (тест/прод)
 * @returns {Promise<Map<string, {ok?: string, error?: string}>>} результати за `lookupKey`
 */
async function runWave(items, model, localProviders, submitBatchImpl) {
  if (items.length === 0 || !model) return new Map()
  try {
    const results = await submitBatchImpl(
      model,
      items.map(i => ({ customId: i.lookupKey, prompt: i.prompt })),
      { localProviders }
    )
    return new Map(results.map(r => [r.customId, r]))
  } catch {
    return new Map()
  }
}

/**
 * Класифікує survived мутантів через `submitBatch` (`N_LOCAL_MIN_MODEL` →
 * `N_CLOUD_MIN_MODEL` → fallback), хвилями замість послідовного циклу.
 * @param {Array<{file: string, mutants: object[], exampleTest?: object|null, recommendationText?: string|null}>} survived survived-мутанти з виміру, згруповані по файлах
 * @param {string} cwd корінь проєкту
 * @param {{cachePath?: string, submitBatchImpl?: (model: string, items: Array<object>, opts?: object) => Promise<Array<object>>,
 *   tier1?: string, tier2?: string, localProviders?: object}} [opts] `tier1`/`tier2` — явні model-specs (дефолт: policy resolver від `N_LOCAL_MIN_MODEL`/`N_CLOUD_MIN_MODEL`);
 *   `submitBatchImpl` — інжект `submitBatch` (тест)
 * @returns {Promise<Array<{key: string, verdict: object}>>} вердикти по кожному мутанту, у вхідному порядку
 */
export async function classify(survived, cwd, opts = {}) {
  const cachePath = opts.cachePath ?? join(cwd, 'reports', 'coverage-classify.cache.json')
  const submitBatchImpl = opts.submitBatchImpl ?? submitBatchNative
  const tier1 = opts.tier1 ?? resolveModel('N_LOCAL_MIN_MODEL')
  const tier2 = opts.tier2 ?? resolveModel('N_CLOUD_MIN_MODEL')
  const localProviders = opts.localProviders ?? defaultLocalProviders()
  const cacheModel = `${tier1 || 'default'}+${tier2 || 'cloud'}`

  const cache = readCache(cachePath)
  if (cache.model !== cacheModel) {
    cache.entries = {}
    cache.model = cacheModel
  }

  const { verdicts, pending } = prepareQueue(survived, cwd, cache)
  if (pending.length === 0) {
    writeCache(cachePath, cache)
    return verdicts
  }

  const byKey = new Map(verdicts.map(v => [v.key, v]))
  const resolve = (item, verdict) => {
    byKey.get(item.lookupKey).verdict = verdict
    if (item.cacheKey) cache.entries[item.cacheKey] = { ...verdict, classifiedAt: new Date().toISOString() }
  }

  const tier1Results = await runWave(pending, tier1, localProviders, submitBatchImpl)
  const tier1Failed = []
  for (const item of pending) {
    const r = tier1Results.get(item.lookupKey)
    if (!r?.ok) {
      tier1Failed.push(item)
      continue
    }
    try {
      resolve(item, parseVerdict(r.ok))
    } catch {
      tier1Failed.push(item)
    }
  }

  if (tier1Failed.length > 0) {
    const tier2Results = await runWave(tier1Failed, tier2, localProviders, submitBatchImpl)
    for (const item of tier1Failed) {
      const r = tier2Results.get(item.lookupKey)
      if (r?.ok) {
        try {
          resolve(item, parseVerdict(r.ok))
          continue
        } catch {
          // впало і на tier2 — падає у fallback нижче
        }
      }
      resolve(item, { ...FALLBACK_VERDICT })
    }
  }

  writeCache(cachePath, cache)
  return verdicts
}
