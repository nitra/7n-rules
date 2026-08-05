/**
 * Тип 2b (OpenAI-сумісний API, batch) — `submitBatch` завжди йде через
 * справжній `/v1/batches` OpenAI-сумісний batch-adapter резолвленого
 * провайдера (спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`).
 * Клієнтську емуляцію (v1, чанкований прогін через Тип 2a) вилучено —
 * провайдер без зареєстрованого `base_url`/`api_key` у `localProviders`
 * повертає явну помилку, без тихого фолбеку.
 *
 * Тонкий JS-клієнт до Rust-крейта `llm_lib::batch`/`llm_lib::remote_batch`
 * через napi FFI in-process (`llm-lib/crates/llm-lib-napi`) — жодного
 * власного HTTP тут (анти-приклад, якого це узагальнює: `mlmail/use-summary.js`
 * чанкує переклади проти omlx вручну, з вистражданими лімітами).
 */
import { loadNative } from './internal/native.mjs'

/**
 * Один item вхідного batch-у.
 * @typedef {{ customId: string, prompt: string, system?: string }} BatchItem
 */

/**
 * Результат одного item — рівно одне з `ok`/`error` заповнене.
 * @typedef {{ customId: string, ok?: string, error?: string }} BatchResult
 */

/**
 * Batch-виклик Типу 2b. `modelSpecOrTier` — той самий контракт, що й у
 * [`oneShotLocalCloud`] з `local-cloud.mjs`: явний `"provider/model-id"`
 * абстрактний тир (`min`/`avg`/`max`) або явний env-selector.
 * @param {string} modelSpecOrTier `"provider/model-id"`, tier або env-selector
 * @param {BatchItem[]} items вхідні items (`customId` — унікальний у межах виклику)
 * @param {{
 *   localProviders?: Record<string, { baseUrl: string, apiKey?: string | null }>,
 *   system?: string,
 *   pollIntervalMs?: number,
 *   pollTimeoutMs?: number,
 *   onProgress?: (completed: number, total: number) => void,
 *   native?: {
 *     submitBatch: (
 *       modelSpecOrTier: string,
 *       items: Array<{ customId: string, prompt: string, system?: string }>,
 *       options?: object,
 *       config?: object,
 *       onProgress?: (completed: number, total: number) => void
 *     ) => Promise<BatchResult[]>
 *   }
 * }} [options] конфіг локальних провайдерів, ліміти опитування, progress-колбек, інжект `native` для тестів
 * @returns {Promise<BatchResult[]>} результати в тому самому порядку, що й вхідні `items`
 */
export function submitBatch(
  modelSpecOrTier,
  items,
  { localProviders, system, pollIntervalMs, pollTimeoutMs, onProgress, native } = {}
) {
  const nativeImpl = native ?? loadNative()
  return nativeImpl.submitBatch(
    modelSpecOrTier,
    items.map(item => ({
      customId: item.customId,
      prompt: item.prompt,
      system: item.system ?? undefined
    })),
    {
      localProviders: localProviders ?? undefined,
      system: system ?? undefined
    },
    {
      pollIntervalMs: pollIntervalMs ?? undefined,
      pollTimeoutMs: pollTimeoutMs ?? undefined
    },
    onProgress ?? undefined
  )
}
