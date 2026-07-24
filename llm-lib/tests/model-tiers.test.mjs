/**
 * Тести pi-model-tiers: pure-функції резолвінгу тирів без pi.
 *   - parseModelId — розбір "provider/model-id" (nested slashes, malformed)
 *   - thinkingLevelForTier — rung-тир → дискретний pi thinkingLevel
 *   - resolveModelSpec — рядок → Model через інжектований fake-registry
 *   - resolveModel — napi-делегація в `llm_lib::resolve_model` (задача T5,
 *     рішення Е): валідація тиру лишається в JS (TypeError на невідомий тир,
 *     native взагалі не викликається), сам каскад — інжектований fake-native
 *     (юніт) + опційний smoke через реально збудований аддон (нижче)
 */

import { describe, expect, test, vi } from 'vitest'
import { formatModelSpec, isLocalModel, parseModelId, resolveModel, thinkingLevelForTier } from '../lib/model-tiers.mjs'
import { resolveModelSpec } from '../lib/internal/registry.mjs'
import { loadNative, resolveNativeAddon } from '../lib/internal/native.mjs'

/**
 * Чи є під рукою реально збудований napi-аддон (dev cargo-збірка чи явний
 * `N_LLM_LIB_NATIVE_ADDON`) — smoke-тести нижче не обов'язкові в CI без
 * Rust-тулчейну, `test.skipIf` пропускає їх, коли аддона нема. Без deps —
 * той самий пошук (env → platform-підпакет → dev cargo-fallback), що й
 * реальний `loadNative()` нижче.
 * @returns {boolean} true — аддон резолвиться без падіння
 */
function nativeAddonAvailable() {
  try {
    resolveNativeAddon()
    return true
  } catch {
    return false
  }
}

describe('isLocalModel', () => {
  test('omlx-провайдер — локальний (дефолт N_LLM_LOCAL_PROVIDERS)', () => {
    expect(isLocalModel('omlx/gemma-4-e4b')).toBe(true)
    expect(isLocalModel('openai/gpt-5.5')).toBe(false)
    expect(isLocalModel('anthropic/claude-fable-5')).toBe(false)
  })

  test('порожній/malformed spec — не локальний', () => {
    expect(isLocalModel('')).toBe(false)
    expect(isLocalModel('no-slash')).toBe(false)
    expect(isLocalModel(null)).toBe(false)
  })

  test('кастомний список провайдерів через env (ізольований re-import)', async () => {
    vi.resetModules()
    vi.stubEnv('N_LLM_LOCAL_PROVIDERS', 'ollama, lmstudio')
    const mod = await import('../lib/model-tiers.mjs')
    expect(mod.isLocalModel('ollama/llama3')).toBe(true)
    expect(mod.isLocalModel('omlx/gemma')).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('parseModelId', () => {
  test('звичайна пара', () => {
    expect(parseModelId('omlx/gemma-4-e4b-it-OptiQ-4bit')).toEqual({
      provider: 'omlx',
      id: 'gemma-4-e4b-it-OptiQ-4bit'
    })
  })

  test('перший / роздільник — id може містити власні /', () => {
    expect(parseModelId('openai/org/gpt-5.4')).toEqual({ provider: 'openai', id: 'org/gpt-5.4' })
  })

  test.each([
    ['', 'порожній рядок'],
    ['noslash', 'без слеша'],
    ['/leading', 'порожній провайдер'],
    ['trailing/', 'порожній id'],
    [null, 'не рядок']
  ])('malformed → null: %s (%s)', spec => {
    expect(parseModelId(spec)).toBeNull()
  })
})

describe('formatModelSpec', () => {
  test('інверсія parseModelId', () => {
    expect(formatModelSpec({ provider: 'omlx', id: 'gemma-4' })).toBe('omlx/gemma-4')
  })

  test.each([[null], [undefined], [{}], [{ provider: 'omlx' }], [{ id: 'gemma-4' }]])(
    'відсутня/неповна модель → null: %j',
    model => {
      expect(formatModelSpec(model)).toBeNull()
    }
  )
})

describe('thinkingLevelForTier', () => {
  test.each([
    ['cloud-max', 'xhigh'],
    ['cloud-avg', 'high'],
    ['cloud-min', 'medium'],
    ['local-min', 'low'],
    ['local-min-retry', 'low'],
    ['невідомий', 'low']
  ])('%s → %s', (tier, level) => {
    expect(thinkingLevelForTier(tier)).toBe(level)
  })
})

describe('resolveModelSpec', () => {
  test('валідний spec → registry.find(provider, id)', () => {
    const model = { provider: 'omlx', id: 'gemma-4-e4b-it-OptiQ-4bit' }
    const registry = { find: vi.fn(() => model) }
    expect(resolveModelSpec(registry, 'omlx/gemma-4-e4b-it-OptiQ-4bit')).toBe(model)
    expect(registry.find).toHaveBeenCalledWith('omlx', 'gemma-4-e4b-it-OptiQ-4bit')
  })

  test('malformed spec → null, registry не чіпається', () => {
    const registry = { find: vi.fn() }
    expect(resolveModelSpec(registry, 'noslash')).toBeNull()
    expect(registry.find).not.toHaveBeenCalled()
  })

  test('registry не знайшов → null (а не undefined)', () => {
    const registry = { find: vi.fn() }
    expect(resolveModelSpec(registry, 'openai/gpt-5.4')).toBeNull()
  })
})

describe('resolveModel (napi-делегація, інжектований fake-native)', () => {
  test('невідомий тир → TypeError, native не викликається взагалі', () => {
    const native = { resolveModel: vi.fn() }
    expect(() => resolveModel('mega', { native })).toThrow(TypeError)
    expect(native.resolveModel).not.toHaveBeenCalled()
  })

  test('делегує рівно tier у native.resolveModel і повертає результат як є', () => {
    const native = { resolveModel: vi.fn(() => 'omlx/local') }
    expect(resolveModel('min', { native })).toBe('omlx/local')
    expect(native.resolveModel).toHaveBeenCalledWith('min')
  })

  test('native повертає null (жодної env-моделі для тиру) → порожній рядок', () => {
    const native = { resolveModel: () => null }
    expect(resolveModel('avg', { native })).toBe('')
  })

  test.each(['min', 'avg', 'max'])('%s — валідний тир, native викликається', tier => {
    const native = { resolveModel: vi.fn(() => null) }
    resolveModel(tier, { native })
    expect(native.resolveModel).toHaveBeenCalledWith(tier)
  })
})

describe('resolveModel (smoke через реально збудований napi-аддон)', () => {
  test.skipIf(!nativeAddonAvailable())('той самий каскад, що й Rust tiers.rs::resolve_model, через живий аддон', () => {
    vi.stubEnv('N_LOCAL_MIN_MODEL', 'omlx/local-min-smoke')
    vi.stubEnv('N_CLOUD_MIN_MODEL', '')
    try {
      const native = loadNative()
      expect(resolveModel('min', { native })).toBe('omlx/local-min-smoke')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
