/**
 * Тип 2b (OpenAI-сумісний API, batch) — `submitBatch` обирає між клієнтською
 * емуляцією (v1, чанкований конкурентний прогін через Тип 2a
 * `llm_lib::local_cloud`) і справжнім `/v1/batches` litellm batch-adapter-а
 * (спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`), під тим
 * самим інтерфейсом `submit → progress → results` для обох. Вибір —
 * `backend` (дефолт `'auto'`: реальний Batch API лише коли резолвлений
 * провайдер `litellm` і кешована мережева проба адаптера пройшла; локальний
 * omlx завжди йде емуляцією).
 *
 * Тонкий JS-клієнт до Rust-крейта `llm_lib::batch`/`llm_lib::remote_batch`
 * через napi FFI in-process (`llm-lib/crates/llm-lib-napi`) — жодного
 * власного чанкінгу чи HTTP тут (анти-приклад, якого це узагальнює:
 * `mlmail/use-summary.js` чанкує переклади проти omlx вручну, з
 * вистражданими лімітами).
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
 *   chunkSize?: number,
 *   concurrency?: number,
 *   backend?: 'emulated' | 'openai-batches' | 'auto',
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
 * }} [options] конфіг локальних провайдерів, ліміти чанка/конкурентності/бекенда/опитування, progress-колбек, інжект `native` для тестів
 * @returns {Promise<BatchResult[]>} результати в тому самому порядку, що й вхідні `items`
 */
export function submitBatch(
  modelSpecOrTier,
  items,
  { localProviders, system, chunkSize, concurrency, backend, pollIntervalMs, pollTimeoutMs, onProgress, native } = {}
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
      chunkSize: chunkSize ?? undefined,
      concurrency: concurrency ?? undefined,
      backend: backend ?? undefined,
      pollIntervalMs: pollIntervalMs ?? undefined,
      pollTimeoutMs: pollTimeoutMs ?? undefined
    },
    onProgress ?? undefined
  )
}
