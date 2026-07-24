/**
 * Тонкий napi-клієнт `lib/local-cloud.mjs`: `oneShotLocalCloud` делегує в
 * `native.oneShotLocalCloud` без власного HTTP-клієнта (інжект native).
 * `modelSpecOrTier` передається як є — і явний `"provider/model-id"`, і
 * абстрактний тир (`min`/`avg`/`max`) розрізняє Rust, не JS-шар (задача T5).
 */

import { describe, expect, test, vi } from 'vitest'

import { oneShotLocalCloud } from '../lib/local-cloud.mjs'

describe('oneShotLocalCloud', () => {
  test('делегує modelSpecOrTier/prompt у native.oneShotLocalCloud і віддає його результат', async () => {
    const native = { oneShotLocalCloud: vi.fn(() => Promise.resolve('відповідь')) }
    await expect(oneShotLocalCloud('min', 'запит', { native })).resolves.toBe('відповідь')
    expect(native.oneShotLocalCloud).toHaveBeenCalledWith('min', 'запит', {
      localProviders: undefined,
      system: undefined
    })
  })

  test('явний "provider/model-id" передається як є (не тільки тир)', async () => {
    const native = { oneShotLocalCloud: vi.fn(() => Promise.resolve('ok')) }
    await oneShotLocalCloud('omlx/gemma-4-e4b', 'запит', { native })
    expect(native.oneShotLocalCloud).toHaveBeenCalledWith('omlx/gemma-4-e4b', 'запит', {
      localProviders: undefined,
      system: undefined
    })
  })

  test('localProviders і system прокидаються в options', async () => {
    const native = { oneShotLocalCloud: vi.fn(() => Promise.resolve('ok')) }
    const localProviders = { omlx: { baseUrl: 'http://127.0.0.1:8000/v1/', apiKey: null } }
    await oneShotLocalCloud('max', 'запит', { localProviders, system: 'ти корисний асистент', native })
    expect(native.oneShotLocalCloud).toHaveBeenCalledWith('max', 'запит', {
      localProviders,
      system: 'ти корисний асистент'
    })
  })

  test('без опцій (лише modelSpecOrTier/prompt) — localProviders/system undefined', async () => {
    const native = { oneShotLocalCloud: vi.fn(() => Promise.resolve('ok')) }
    await oneShotLocalCloud('avg', 'запит', { native })
    expect(native.oneShotLocalCloud).toHaveBeenCalledWith('avg', 'запит', {
      localProviders: undefined,
      system: undefined
    })
  })
})
