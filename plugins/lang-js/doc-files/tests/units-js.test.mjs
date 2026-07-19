import { describe, expect, test } from 'vitest'

import jsDocFilesExtractor, { extractFacts } from '../extractors.mjs'
import { extractUnitsJs } from '../units-js.mjs'

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
    expect(units.map(u => u.name).toSorted()).toEqual(['Inner', 'check', 'helper', 'parse'])
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

describe('default-експорт handler-модуля doc-files', () => {
  test('форма екстрактора: id, розширення, обидві функції', () => {
    expect(jsDocFilesExtractor.id).toBe('js')
    expect(jsDocFilesExtractor.extensions).toEqual(['.js', '.mjs', '.ts', '.vue'])
    expect(jsDocFilesExtractor.extractUnits(SRC, 'x.mjs').length).toBe(4)
  })

  test('vue → unsupported факти (whole-file шлях), юніти null', () => {
    expect(extractFacts('<template></template>', 'c.vue').unsupported).toBe(true)
    expect(jsDocFilesExtractor.extractUnits('<template></template>', 'c.vue')).toBeNull()
  })
})
