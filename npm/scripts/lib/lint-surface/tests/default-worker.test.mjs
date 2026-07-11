/**
 * Тести default-worker: env-гейт anchored-профілю (Фаза A2).
 * Сам fixWorker — тонкий адаптер runAgentFix, покритий інтеграційно у run-fix.test.mjs.
 */

import { afterEach, describe, expect, test } from 'vitest'
import { env } from 'node:process'
import { anchoredEnabled } from '../default-worker.mjs'

const isLocal = spec => spec.startsWith('omlx/')

describe('anchoredEnabled (env N_LLM_FIX_ANCHORED)', () => {
  const saved = env.N_LLM_FIX_ANCHORED
  afterEach(() => {
    if (saved === undefined) delete env.N_LLM_FIX_ANCHORED
    else env.N_LLM_FIX_ANCHORED = saved
  })

  test('дефолт (env відсутній) = cloud: не-local увімкнено, local вимкнено', () => {
    delete env.N_LLM_FIX_ANCHORED
    expect(anchoredEnabled('openai-codex/gpt-5.4-mini', isLocal)).toBe(true)
    expect(anchoredEnabled('omlx/gemma', isLocal)).toBe(false)
    expect(anchoredEnabled(undefined, isLocal)).toBe(false)
  })

  test('"1" — усі тири, включно з local', () => {
    env.N_LLM_FIX_ANCHORED = '1'
    expect(anchoredEnabled('omlx/gemma', isLocal)).toBe(true)
    expect(anchoredEnabled('openai-codex/gpt-5.5', isLocal)).toBe(true)
  })

  test('"0" (та будь-яке інше значення) — повністю вимкнено', () => {
    env.N_LLM_FIX_ANCHORED = '0'
    expect(anchoredEnabled('openai-codex/gpt-5.5', isLocal)).toBe(false)
    env.N_LLM_FIX_ANCHORED = 'off'
    expect(anchoredEnabled('openai-codex/gpt-5.5', isLocal)).toBe(false)
  })

  test('"cloud" явно — як дефолт', () => {
    env.N_LLM_FIX_ANCHORED = 'cloud'
    expect(anchoredEnabled('openai-codex/gpt-5.4-mini', isLocal)).toBe(true)
    expect(anchoredEnabled('omlx/gemma', isLocal)).toBe(false)
  })
})
