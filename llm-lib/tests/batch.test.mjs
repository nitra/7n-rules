/**
 * Тонкий napi-клієнт `lib/batch.mjs`: `submitBatch` делегує в
 * `native.submitBatch` без власного чанкінгу/паралелізму (інжект native,
 * задача T6) — весь чанкований конкурентний прогін живе в
 * `llm_lib::batch` (Rust).
 */

import { describe, expect, test, vi } from 'vitest'

import { submitBatch } from '../lib/batch.mjs'

describe('submitBatch', () => {
  test('делегує modelSpecOrTier/items у native.submitBatch і віддає його результат', async () => {
    const items = [{ customId: 'a', prompt: 'запит A' }]
    const native = {
      submitBatch: vi.fn(() => Promise.resolve([{ customId: 'a', ok: 'відповідь A', error: undefined }]))
    }
    await expect(submitBatch('min', items, { native })).resolves.toEqual([
      { customId: 'a', ok: 'відповідь A', error: undefined }
    ])
    expect(native.submitBatch).toHaveBeenCalledWith(
      'min',
      [{ customId: 'a', prompt: 'запит A', system: undefined }],
      { localProviders: undefined, system: undefined },
      { chunkSize: undefined, concurrency: undefined },
      undefined
    )
  })

  test('явний "provider/model-id" передається як є (не тільки тир)', async () => {
    const native = { submitBatch: vi.fn(() => Promise.resolve([])) }
    await submitBatch('omlx/gemma-4-e4b', [{ customId: 'a', prompt: 'запит' }], { native })
    expect(native.submitBatch.mock.calls[0][0]).toBe('omlx/gemma-4-e4b')
  })

  test('кожен item нормалізується до {customId, prompt, system}, навіть без власного system', async () => {
    const native = { submitBatch: vi.fn(() => Promise.resolve([])) }
    const items = [
      { customId: 'a', prompt: 'запит A' },
      { customId: 'b', prompt: 'запит B', system: 'ти асистент' }
    ]
    await submitBatch('avg', items, { native })
    expect(native.submitBatch.mock.calls[0][1]).toEqual([
      { customId: 'a', prompt: 'запит A', system: undefined },
      { customId: 'b', prompt: 'запит B', system: 'ти асистент' }
    ])
  })

  test('localProviders/system/chunkSize/concurrency прокидаються в options/config', async () => {
    const native = { submitBatch: vi.fn(() => Promise.resolve([])) }
    const localProviders = { omlx: { baseUrl: 'http://127.0.0.1:8000/v1/', apiKey: null } }
    await submitBatch('max', [{ customId: 'a', prompt: 'запит' }], {
      localProviders,
      system: 'ти корисний асистент',
      chunkSize: 15,
      concurrency: 4,
      native
    })
    expect(native.submitBatch).toHaveBeenCalledWith(
      'max',
      [{ customId: 'a', prompt: 'запит', system: undefined }],
      { localProviders, system: 'ти корисний асистент' },
      { chunkSize: 15, concurrency: 4 },
      undefined
    )
  })

  test('onProgress прокидається останнім аргументом', async () => {
    const native = { submitBatch: vi.fn(() => Promise.resolve([])) }
    const onProgress = vi.fn()
    await submitBatch('min', [{ customId: 'a', prompt: 'запит' }], { onProgress, native })
    expect(native.submitBatch.mock.calls[0][4]).toBe(onProgress)
  })

  test('без опцій (лише modelSpecOrTier/items) — усе інше undefined', async () => {
    const native = { submitBatch: vi.fn(() => Promise.resolve([])) }
    await submitBatch('avg', [{ customId: 'a', prompt: 'запит' }], { native })
    expect(native.submitBatch).toHaveBeenCalledWith(
      'avg',
      [{ customId: 'a', prompt: 'запит', system: undefined }],
      { localProviders: undefined, system: undefined },
      { chunkSize: undefined, concurrency: undefined },
      undefined
    )
  })

  test('порожній список items передається як є', async () => {
    const native = { submitBatch: vi.fn(() => Promise.resolve([])) }
    await expect(submitBatch('min', [], { native })).resolves.toEqual([])
    expect(native.submitBatch.mock.calls[0][1]).toEqual([])
  })
})
