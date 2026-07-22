import { describe, expect, test } from 'vitest'

import { quickClassify } from '../lib/quick-classify.mjs'

describe('quickClassify', () => {
  test('чистий wiring (імпорти/реекспорти) → needsTests:false', () => {
    const src = "import { a } from './a.mjs'\nexport { a }\nexport * from './b.mjs'\n"
    expect(quickClassify(src)).toEqual({ needsTests: false, reason: 'лише імпорти/реекспорти без логіки' })
  })

  test('функції з розгалуженнями → needsTests:true', () => {
    const src = 'export function f(x) {\n  if (x > 0) { return 1 }\n  return 0\n}\n'
    expect(quickClassify(src)).toEqual({ needsTests: true, reason: 'містить функції з розгалуженнями' })
  })

  test('коментарі не впливають на вердикт', () => {
    const src = "// if (fake) branch у коментарі\n/* function fake() {} */\nimport { a } from './a.mjs'\nexport { a }\n"
    expect(quickClassify(src)?.needsTests).toBe(false)
  })

  test('неоднозначний файл (константи без розгалужень) → null', () => {
    const src = "export const LIMIT = 5\nconst hidden = 'x'\nconsole.log(hidden)\n"
    expect(quickClassify(src)).toBeNull()
  })

  test('стрілкова функція з switch → needsTests:true', () => {
    const src = 'export const pick = v => {\n  switch (v) {\n    default:\n      return 0\n  }\n}\n'
    expect(quickClassify(src)?.needsTests).toBe(true)
  })
})
