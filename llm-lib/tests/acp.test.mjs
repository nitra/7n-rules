/**
 * Тонкий napi-клієнт `lib/acp.mjs`: `runAcpAgent` делегує в
 * `native.oneShotAcp` без власної протокольної логіки (інжект native).
 * Задача T5: 4-й аргумент — опції `{ tier, native }` (сумісний зі старим
 * `{ native }`-викликом), `tier` прокидається в napi як є, `kind: 'pi'`
 * дозволений на JS-рівні (валідація kind-у — глибше, у Rust).
 */

import { describe, expect, test, vi } from 'vitest'

import { runAcpAgent } from '../lib/acp.mjs'
import { loadNative, resolveNativeAddon } from '../lib/internal/native.mjs'

/**
 * Чи є під рукою реально збудований napi-аддон (dev cargo-збірка чи явний
 * `N_LLM_LIB_NATIVE_ADDON`) — `getAcpPresets`-smoke нижче не обов'язковий у
 * CI без Rust-тулчейну.
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

describe('runAcpAgent', () => {
  test('делегує kind/prompt/cwd у native.oneShotAcp і віддає його результат', async () => {
    const calls = []
    const native = {
      oneShotAcp: (kind, prompt, cwd) => {
        calls.push([kind, prompt, cwd])
        return Promise.resolve('відповідь')
      }
    }
    await expect(runAcpAgent('codex', 'зроби X', '/proj', { native })).resolves.toBe('відповідь')
    expect(calls).toEqual([['codex', 'зроби X', '/proj']])
  })

  test('без опцій (старий виклик без 4-го аргументу) — tier не заданий', async () => {
    const native = { oneShotAcp: vi.fn(() => Promise.resolve('ok')) }
    await runAcpAgent('cursor', 'prompt', '/proj', { native })
    expect(native.oneShotAcp).toHaveBeenCalledWith('cursor', 'prompt', '/proj', undefined)
  })

  test('tier прокидається в native.oneShotAcp четвертим аргументом', async () => {
    const native = { oneShotAcp: vi.fn(() => Promise.resolve('ok')) }
    await runAcpAgent('cursor', 'prompt', '/proj', { tier: 'avg', native })
    expect(native.oneShotAcp).toHaveBeenCalledWith('cursor', 'prompt', '/proj', 'avg')
  })

  test('kind "pi" пропускається у native без додаткової валідації на JS-рівні', async () => {
    const native = { oneShotAcp: vi.fn(() => Promise.resolve('ok')) }
    await runAcpAgent('pi', 'prompt', '/proj', { tier: 'min', native })
    expect(native.oneShotAcp).toHaveBeenCalledWith('pi', 'prompt', '/proj', 'min')
  })
})

describe('getAcpPresets (smoke через реально збудований napi-аддон)', () => {
  test.skipIf(!nativeAddonAvailable())(
    'native.getAcpPresets віддає command/label для cursor/codex/pi і label/env/args/postSessionConfig для кожного тиру',
    () => {
      const native = loadNative()
      const presets = native.getAcpPresets()

      for (const kind of ['cursor', 'codex', 'pi']) {
        expect(presets[kind].command).toEqual(expect.any(String))
        expect(presets[kind].label).toEqual(expect.any(String))
        for (const tier of ['min', 'avg', 'max']) {
          const preset = presets[kind].tiers[tier]
          expect(preset.label).toEqual(expect.any(String))
          expect(preset.env).toEqual(expect.any(Object))
          expect(Array.isArray(preset.args)).toBe(true)
        }
      }

      // Pi резолвить тір через post-session config, не env/args (рішення З.1).
      expect(presets.pi.tiers.min.postSessionConfig).toEqual({
        configId: 'model',
        value: 'openai-codex/gpt-5.6-luna'
      })
      // Codex — через env.
      expect(presets.codex.tiers.avg.env.CODEX_CONFIG).toBe('{"model":"gpt-5.6-terra"}')
      // Cursor — через extra-args.
      expect(presets.cursor.tiers.max.args).toEqual(['--model', 'gpt-5.6-sol-max'])
    }
  )
})
