/**
 * Тип 2b (OpenAI-сумісний API, batch) — **лише емуляція** у v1 (рішення Р,
 * задача T6): чанкований конкурентний прогін через Тип 2a
 * (`llm_lib::local_cloud`) під інтерфейсом `submit → progress → results` —
 * той самий інтерфейс, яким говорив би й справжній OpenAI Batch API
 * (`/v1/batches`, v2), якому локальний omlx (перший споживач) не має.
 *
 * Тонкий JS-клієнт до Rust-крейта `llm_lib::batch` через napi FFI
 * in-process (`llm-lib/crates/llm-lib-napi`) — жодного власного чанкінгу
 * тут (анти-приклад, якого це узагальнює: `mlmail/use-summary.js` чанкує
 * переклади проти omlx вручну, з вистражданими лімітами).
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
 * Емуляція batch-виклику Типу 2b. `modelSpecOrTier` — той самий контракт,
 * що й у [`oneShotLocalCloud`] з `local-cloud.mjs`: явний
 * `"provider/model-id"` або абстрактний тир (`min`/`avg`/`max`).
 * @param {string} modelSpecOrTier `"provider/model-id"` або `'min'|'avg'|'max'`
 * @param {BatchItem[]} items вхідні items (`customId` — унікальний у межах виклику)
 * @param {{
 *   localProviders?: Record<string, { baseUrl: string, apiKey?: string | null }>,
 *   system?: string,
 *   chunkSize?: number,
 *   concurrency?: number,
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
 * }} [options] конфіг локальних провайдерів, ліміти чанка/конкурентності, progress-колбек, інжект `native` для тестів
 * @returns {Promise<BatchResult[]>} результати в тому самому порядку, що й вхідні `items`
 */
export function submitBatch(
  modelSpecOrTier,
  items,
  { localProviders, system, chunkSize, concurrency, onProgress, native } = {}
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
      concurrency: concurrency ?? undefined
    },
    onProgress ?? undefined
  )
}
