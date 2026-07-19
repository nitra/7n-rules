/**
 * Тести розпізнавання бібліотеки компонентів Vue (vue у peerDependencies) — для винятку з правила
 * auto-import (vue.mdc: явні `import { … } from 'vue'` у таких пакетах дозволені).
 */
import { describe, expect, test } from 'vitest'

import { isVueComponentLibraryPkg } from '../main.mjs'

describe('isVueComponentLibraryPkg', () => {
  test('true: vue у peerDependencies', () => {
    expect(isVueComponentLibraryPkg({ peerDependencies: { vue: '^3.6.0' } })).toBe(true)
  })

  test('true: vue і в dependencies, і в peerDependencies (повноцінний пакет-бібліотека)', () => {
    expect(isVueComponentLibraryPkg({ dependencies: { vue: '^3.6.0' }, peerDependencies: { vue: '^3.6.0' } })).toBe(
      true
    )
  })

  test('false: vue лише в dependencies (звичайний Vite-додаток)', () => {
    expect(isVueComponentLibraryPkg({ dependencies: { vue: '^3.6.0' } })).toBe(false)
  })

  test('false: vue у devDependencies, але не в peerDependencies', () => {
    expect(isVueComponentLibraryPkg({ devDependencies: { vue: '^3.6.0' } })).toBe(false)
  })

  test('false: peerDependencies без vue', () => {
    expect(isVueComponentLibraryPkg({ peerDependencies: { react: '^19.0.0' } })).toBe(false)
  })

  test('false: порожній / відсутній package.json', () => {
    expect(isVueComponentLibraryPkg({})).toBe(false)
    expect(isVueComponentLibraryPkg(null)).toBe(false)
  })
})
