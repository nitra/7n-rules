import { describe, expect, test } from 'vitest'

import { extractUnitsJs } from '../units-js.mjs'
import { extractUnits } from '../units.mjs'

const SRC = `
/** Публічна точка входу. */
export function check(cwd) {
  return helper(cwd)
}

/** Службовий помічник. */
function helper(x) {
  return x + 1
}

/** Const-стрілка. */
export const parse = input => check(input)

class Inner {}
`

describe('extractUnitsJs — юніти top-level', () => {
  const units = extractUnitsJs(SRC, 'x.mjs')
  const by = name => units.find(u => u.name === name)

  test('знаходить function/const/class', () => {
    expect(units.map(u => u.name).sort()).toEqual(['Inner', 'check', 'helper', 'parse'])
  })

  test('прапор exported коректний', () => {
    expect(by('check').exported).toBe(true)
    expect(by('parse').exported).toBe(true)
    expect(by('helper').exported).toBe(false)
    expect(by('Inner').exported).toBe(false)
  })

  test('kind розрізняє function/const/class', () => {
    expect(by('check').kind).toBe('function')
    expect(by('parse').kind).toBe('const')
    expect(by('Inner').kind).toBe('class')
  })

  test('call-graph — лише виклики інших юнітів, без самопосилання', () => {
    expect(by('check').calls).toEqual(['helper'])
    expect(by('parse').calls).toEqual(['check'])
    expect(by('helper').calls).toEqual([])
  })

  test('JSDoc і тіло захоплені', () => {
    expect(by('check').doc).toBe('Публічна точка входу.')
    expect(by('check').body).toContain('return helper(cwd)')
  })

  test('файл, що не парситься → null', () => {
    expect(extractUnitsJs('export const x = (', 'bad.mjs')).toBeNull()
  })
})

describe('extractUnits — фасад за розширенням', () => {
  test('js/ts → юніти', () => {
    expect(extractUnits(SRC, 'x.mjs').length).toBe(4)
  })

  test('поки непідтримані мови → null (fallback на whole-file)', () => {
    expect(extractUnits('<template></template>', 'c.vue')).toBeNull()
    expect(extractUnits('def f(): pass', 's.py')).toBeNull()
  })
})
