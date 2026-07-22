import { describe, expect, test } from 'vitest'

import provider from '../provider.mjs'

describe('CoverageProvider fix-hooks (lang-js)', () => {
  test('провайдер декларує всі опційні fix-hooks як функції', () => {
    expect(typeof provider.generateTests).toBe('function')
    expect(typeof provider.generateStories).toBe('function')
    expect(typeof provider.fixSurvived).toBe('function')
    expect(typeof provider.fixFailingTests).toBe('function')
  })

  test('generateTests/generateStories/fixSurvived — no-op на порожньому вході без LLM-стеку', async () => {
    // Порожній вхід повертається ДО lazy-import fix-модулів — жодних side effects.
    await expect(provider.generateTests({ cwd: '/nowhere', files: [], ctx: {} })).resolves.toEqual({
      touchedFiles: []
    })
    await expect(provider.generateStories({ cwd: '/nowhere', files: [], ctx: {} })).resolves.toEqual({
      touchedFiles: []
    })
    await expect(provider.fixSurvived({ cwd: '/nowhere', survived: [], ctx: {} })).resolves.toEqual({
      touchedFiles: []
    })
  })
})
