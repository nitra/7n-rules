import { describe, expect, test } from 'vitest'

import { runLintStep } from '../run-lint-step.mjs'

describe('runLintStep', () => {
  test('127 — команда відсутня в PATH', () => {
    expect(runLintStep('noop-lint', '__no_such_bin__', [])).toBe(127)
  })

  test('0 — команда "true" повертає 0', () => {
    expect(runLintStep('truth-check', 'true', [])).toBe(0)
  })

  test('1 — команда "false" повертає 1', () => {
    expect(runLintStep('false-check', 'false', [])).toBe(1)
  })

  test('0 — echo з аргументом повертає 0', () => {
    expect(runLintStep('echo-check', 'echo', ['hello'])).toBe(0)
  })
})
