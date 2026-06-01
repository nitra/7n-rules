/**
 * Тести Capability Router (`lib/capability.mjs`) — чистий резолвер режиму
 * оркестрації за явною декларацією моделі (spec §2.2).
 */
import { describe, expect, test } from 'vitest'

import {
  DEFAULT_ORCHESTRATION,
  declaredModel,
  orchestrationFor,
  parseModelFlag,
  polyfillStartable
} from '../capability.mjs'

const MATRIX = {
  models: {
    'claude-sonnet-4-6': { orchestration: 'polyfill' },
    'claude-4-8-opus': { orchestration: 'native' }
  },
  default: { orchestration: 'polyfill' }
}

describe('parseModelFlag', () => {
  test('витягує значення після --model', () => {
    expect(parseModelFlag(['run', '--model', 'claude-4-8-opus', 'task'])).toBe('claude-4-8-opus')
  })
  test('null, якщо прапорця нема', () => {
    expect(parseModelFlag(['run', 'task'])).toBe(null)
  })
  test('null, якщо --model останній (без значення)', () => {
    expect(parseModelFlag(['run', '--model'])).toBe(null)
  })
})

describe('declaredModel', () => {
  test('пріоритет CLI > env > config', () => {
    expect(declaredModel({ cliModel: 'a', envModel: 'b', configModel: 'c' })).toBe('a')
    expect(declaredModel({ cliModel: null, envModel: 'b', configModel: 'c' })).toBe('b')
    expect(declaredModel({ cliModel: null, envModel: null, configModel: 'c' })).toBe('c')
  })
  test('null, якщо ніде не оголошено', () => {
    expect(declaredModel({})).toBe(null)
    expect(declaredModel()).toBe(null)
  })
})

describe('orchestrationFor', () => {
  test('native-модель → native', () => {
    expect(orchestrationFor('claude-4-8-opus', MATRIX)).toBe('native')
  })
  test('polyfill-модель → polyfill', () => {
    expect(orchestrationFor('claude-sonnet-4-6', MATRIX)).toBe('polyfill')
  })
  test('невідома модель → matrix.default', () => {
    expect(orchestrationFor('mystery', MATRIX)).toBe('polyfill')
  })
  test('null-модель → matrix.default', () => {
    expect(orchestrationFor(null, MATRIX)).toBe('polyfill')
  })
  test('без matrix.default → DEFAULT_ORCHESTRATION', () => {
    expect(orchestrationFor('mystery', { models: {} })).toBe(DEFAULT_ORCHESTRATION)
  })
})

describe('polyfillStartable', () => {
  test('true лише за наявного runner-а', () => {
    expect(polyfillStartable({ hasRunner: true })).toBe(true)
    expect(polyfillStartable({ hasRunner: false })).toBe(false)
  })
})
