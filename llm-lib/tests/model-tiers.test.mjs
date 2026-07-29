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

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'
import { formatModelSpec, isLocalModel, parseModelId, resolveModel, thinkingLevelForTier } from '../lib/model-tiers.mjs'
import { resolveModelSpec } from '../lib/internal/registry.mjs'
import { resolveNativeAddon } from '../lib/internal/native.mjs'

const here = dirname(fileURLToPath(import.meta.url))

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

  test('litellm-провайдер — теж локальний за дефолтом (перемикач omlx/litellm через тир-env)', () => {
    expect(isLocalModel('litellm/gemma-4-26b-awq')).toBe(true)
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

  test('tier alias делегує відповідну env-сходинку і повертає результат як є', () => {
    const native = { resolveModel: vi.fn(() => 'omlx/local') }
    expect(resolveModel('min', { native })).toBe('omlx/local')
    expect(native.resolveModel).toHaveBeenCalledWith('N_LOCAL_MIN_MODEL')
  })

  test('native повертає null (жодної env-моделі для тиру) → порожній рядок', () => {
    const native = { resolveModel: () => null }
    expect(resolveModel('avg', { native })).toBe('')
  })

  test.each([
    ['min', 'N_LOCAL_MIN_MODEL'],
    ['avg', 'N_LOCAL_AVG_MODEL'],
    ['max', 'N_LOCAL_MAX_MODEL'],
    ['N_CLOUD_MIN_MODEL', 'N_CLOUD_MIN_MODEL'],
    ['N_CLOUD_AVG_MODEL', 'N_CLOUD_AVG_MODEL'],
    ['N_CLOUD_MAX_MODEL', 'N_CLOUD_MAX_MODEL']
  ])('%s → %s', (selector, start) => {
    const native = { resolveModel: vi.fn(() => null) }
    resolveModel(selector, { native })
    expect(native.resolveModel).toHaveBeenCalledWith(start)
  })
})

describe('resolveModel (універсальна env-драбина)', () => {
  test('явний cloud selector передається без local-пониження', () => {
    const native = { resolveModel: vi.fn(() => 'openai/avg') }
    expect(resolveModel('N_CLOUD_AVG_MODEL', { native })).toBe('openai/avg')
    expect(native.resolveModel).toHaveBeenCalledWith('N_CLOUD_AVG_MODEL')
  })
})

describe('resolveModel (smoke через реально збудований napi-аддон)', () => {
  // Каскад ганяється в дочірньому процесі з env, заданим при spawn, а не через
  // `vi.stubEnv` у самому тесті: під Bun запис у `process.env` не доходить до
  // нативного environ (setenv не викликається), тож Rust `env::var` аддона
  // бачив би ambient-значення машини замість стабів. Env зі `spawnSync`
  // ОС передає процесу при запуску — його аддон бачить в обох runtime (node і bun).
  test.skipIf(!nativeAddonAvailable())('той самий каскад, що й Rust tiers.rs::resolve_model, через живий аддон', () => {
    const script = `
import { loadNative } from ${JSON.stringify(pathToFileURL(join(here, '..', 'lib', 'internal', 'native.mjs')).href)}
import { resolveModel } from ${JSON.stringify(pathToFileURL(join(here, '..', 'lib', 'model-tiers.mjs')).href)}
process.stdout.write(resolveModel('N_LOCAL_MIN_MODEL', { native: loadNative() }))
`
    const dir = mkdtempSync(join(tmpdir(), 'model-tiers-smoke-'))
    try {
      const scriptPath = join(dir, 'smoke.mjs')
      writeFileSync(scriptPath, script)
      const proc = spawnSync(process.execPath, [scriptPath], {
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          N_LLM_LIB_NATIVE_ADDON: resolveNativeAddon(),
          N_LOCAL_MIN_MODEL: 'omlx/local-min-smoke',
          N_CLOUD_MIN_MODEL: ''
        }
      })
      expect(proc.status, proc.stderr).toBe(0)
      expect(proc.stdout).toBe('omlx/local-min-smoke')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
