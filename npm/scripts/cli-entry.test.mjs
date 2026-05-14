/**
 * Тести визначення прямого запуску CLI-модуля.
 */
import { describe, expect, test } from 'bun:test'

import { isRunAsCli } from './cli-entry.mjs'

describe('isRunAsCli', () => {
  test('при імпорті модуля з тесту — false (головний файл — тест)', () => {
    expect(isRunAsCli()).toBe(false)
  })
})
