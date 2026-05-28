/**
 * Юніт-тести Stryker `Ignore`-плагіна `vue-macros` — пропускає мутації виклику
 * Vue `<script setup>`-макросів. Перевіряємо `shouldIgnore(path)` на синтетичних
 * NodePath-стабах, оскільки Stryker-instrumenter передає сюди babel NodePath
 * у production.
 */
import { describe, expect, test } from 'vitest'

import {
  shouldIgnore,
  strykerPlugins
} from '../data/stryker_config/stryker-vue-macros-ignorer.mjs'

/**
 * Створює мінімальний NodePath-стаб з babel-подібним API, який потрібен ignorer-у.
 * @param {{type: string, calleeType?: string, calleeName?: string}} opts параметри стаба
 * @returns {{isCallExpression: () => boolean, node: {callee: {type: string, name?: string}}}} NodePath-стаб
 */
function makePath({ type, calleeType = 'Identifier', calleeName }) {
  return {
    isCallExpression() {
      return type === 'CallExpression'
    },
    node: {
      callee: { type: calleeType, name: calleeName }
    }
  }
}

describe('stryker-vue-macros-ignorer plugin', () => {
  test('exports strykerPlugins array with single Ignore plugin "vue-macros"', () => {
    expect(Array.isArray(strykerPlugins)).toBe(true)
    expect(strykerPlugins).toHaveLength(1)
    expect(strykerPlugins[0].kind).toBe('Ignore')
    expect(strykerPlugins[0].name).toBe('vue-macros')
    expect(typeof strykerPlugins[0].value.shouldIgnore).toBe('function')
  })

  test.each([
    'defineProps',
    'defineEmits',
    'defineModel',
    'defineSlots',
    'defineExpose',
    'defineOptions'
  ])('повертає non-empty message для CallExpression macro %s()', macro => {
    const path = makePath({ type: 'CallExpression', calleeName: macro })
    const msg = shouldIgnore(path)
    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(0)
  })

  test('повертає undefined для CallExpression з НЕ-macro callee', () => {
    const path = makePath({ type: 'CallExpression', calleeName: 'console' })
    expect(shouldIgnore(path)).toBeUndefined()
  })

  test('повертає undefined для NON-CallExpression (наприклад ObjectExpression)', () => {
    const path = makePath({ type: 'ObjectExpression', calleeName: 'defineProps' })
    expect(shouldIgnore(path)).toBeUndefined()
  })

  test('повертає undefined коли callee — MemberExpression (defineProps.foo())', () => {
    const path = makePath({ type: 'CallExpression', calleeType: 'MemberExpression', calleeName: 'defineProps' })
    expect(shouldIgnore(path)).toBeUndefined()
  })

  test('повертає undefined для CallExpression без identifier callee.name (anonymous)', () => {
    const path = makePath({ type: 'CallExpression', calleeName: undefined })
    expect(shouldIgnore(path)).toBeUndefined()
  })
})
