/**
 * Інтеграційний тест `getRegistry()` — БЕЗ мокання pi: реально імпортує
 * `@earendil-works/pi-coding-agent` і будує registry, як у продакшн-коді.
 * Ловить розсинхрон із реальним публічним API pi (на відміну від
 * `one-shot.test.mjs`/`agent-*.test.mjs`, де registry інжектується fake-DI
 * і реальний виклик pi жодного разу не виконується).
 */

import { describe, expect, test } from 'vitest'
import { getRegistry, resolveModelSpec } from '../lib/internal/registry.mjs'

describe('getRegistry (реальний pi, без моків)', () => {
  test('не кидає та повертає registry з .find()', async () => {
    const registry = await getRegistry()
    expect(typeof registry.find).toBe('function')
  })

  test('lazy singleton — повторний виклик повертає той самий інстанс', async () => {
    const a = await getRegistry()
    const b = await getRegistry()
    expect(a).toBe(b)
  })

  test('resolveModelSpec на malformed вході повертає null (реальний registry)', async () => {
    const registry = await getRegistry()
    expect(resolveModelSpec(registry, 'noslash')).toBeNull()
  })
})
