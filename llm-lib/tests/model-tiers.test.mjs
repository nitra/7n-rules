/**
 * Тести pi-model-tiers: pure-функції резолвінгу тирів без pi.
 *   - parseModelId — розбір "provider/model-id" (nested slashes, malformed)
 *   - thinkingLevelForTier — rung-тир → дискретний pi thinkingLevel
 *   - resolveModelSpec — рядок → Model через інжектований fake-registry
 *   - resolveModel — каскад min/avg/max (через stubEnv + ізольований re-import)
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { isLocalModel, parseModelId, thinkingLevelForTier } from '../lib/model-tiers.mjs'
import { resolveModelSpec } from '../lib/internal/registry.mjs'

/**
 * Ізольований re-import pi-model-tiers зі свіжими env-стабами.
 * @param {Record<string, string>} envVars env-змінні для stubEnv перед імпортом
 * @returns {Promise<(tier: 'min'|'avg'|'max') => string>} свіжа resolveModel із перечитаного модуля
 */
async function freshResolveModel(envVars) {
  vi.resetModules()
  for (const [k, v] of Object.entries(envVars)) vi.stubEnv(k, v)
  const mod = await import('../lib/model-tiers.mjs')
  return mod.resolveModel
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

describe('resolveModel (каскад, ізольований re-import з stubEnv)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  test('min: LOCAL_MIN має пріоритет', async () => {
    const resolveModel = await freshResolveModel({
      N_LOCAL_MIN_MODEL: 'omlx/local',
      N_CLOUD_MIN_MODEL: 'openai/cloud'
    })
    expect(resolveModel('min')).toBe('omlx/local')
  })

  test('min: падіння до CLOUD_MIN коли локальних нема', async () => {
    const resolveModel = await freshResolveModel({
      N_LOCAL_MIN_MODEL: '',
      N_LOCAL_AVG_MODEL: '',
      N_LOCAL_MAX_MODEL: '',
      N_CLOUD_MIN_MODEL: 'openai/cloud'
    })
    expect(resolveModel('min')).toBe('openai/cloud')
  })

  test('нічого не задано → пустий рядок (pi-дефолт)', async () => {
    const resolveModel = await freshResolveModel({
      N_LOCAL_MIN_MODEL: '',
      N_LOCAL_AVG_MODEL: '',
      N_LOCAL_MAX_MODEL: '',
      N_CLOUD_MIN_MODEL: ''
    })
    expect(resolveModel('min')).toBe('')
  })

  test('невідомий тир → TypeError', async () => {
    const resolveModel = await freshResolveModel({})
    expect(() => resolveModel('mega')).toThrow(TypeError)
  })
})
