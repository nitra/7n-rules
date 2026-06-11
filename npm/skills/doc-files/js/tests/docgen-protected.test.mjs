import { describe, expect, test } from 'vitest'

import { splitProtected, insertProtected, scoreDoc } from '../docgen-gen.mjs'

const WITH_INTENT = `# foo.mjs

## Призначення

Рукотворний контракт. Деталі формату.

### Підрозділ

Ще деталі.

## Огляд

Машинний огляд.

## Поведінка

Крок один.
`

describe('splitProtected — захищена секція «Призначення» (Варіант B)', () => {
  test('витягує тіло, межа на наступному H2; ### усередині не обриває', () => {
    const { body } = splitProtected(WITH_INTENT)
    expect(body).toContain('Рукотворний контракт')
    expect(body).toContain('### Підрозділ')
    expect(body).toContain('Ще деталі')
    expect(body).not.toContain('Машинний огляд')
  })

  test('without прибирає блок, лишає машинні секції', () => {
    const { without } = splitProtected(WITH_INTENT)
    expect(without).not.toContain('Рукотворний контракт')
    expect(without).toContain('## Огляд')
    expect(without).toContain('Машинний огляд')
  })

  test('немає секції → body=null, without=md без змін', () => {
    const md = '# x\n\n## Огляд\n\nтекст\n'
    expect(splitProtected(md)).toEqual({ body: null, without: md })
  })
})

describe('insertProtected — вставка після H1', () => {
  test('intent потрапляє між H1 і першою машинною секцією', () => {
    const machine = '# foo.mjs\n\n## Огляд\n\nОгляд тут.\n'
    const out = insertProtected(machine, 'Контракт A.')
    expect(out).toMatch(/# foo\.mjs[\s\S]*## Призначення[\s\S]*Контракт A\.[\s\S]*## Огляд/)
  })

  test('порожній intent → без змін', () => {
    const machine = '# foo.mjs\n\n## Огляд\n\nх\n'
    expect(insertProtected(machine, null)).toBe(machine)
  })

  test('roundtrip: insert → split повертає те саме тіло', () => {
    const out = insertProtected('# f\n\n## Огляд\n\nx\n', 'Контракт Б.')
    expect(splitProtected(out).body).toBe('Контракт Б.')
  })
})

describe('scoreDoc — захищена секція виключена зі скорингу', () => {
  const FACTS = { markers: { caches: false }, internalSymbols: [], localSymbols: [] }

  test('суржик у «Призначення» НЕ штрафує', () => {
    const md = `# f\n\n## Призначення\n\nРаніше працювало у відповідності з планом.\n\n## Огляд\n\nЧистий конкретний огляд про bun.lock.\n\n## Поведінка\n\nКрок.\n`
    expect(scoreDoc(md, FACTS).issues).not.toContain('surzhik')
  })

  test('суржик у машинній секції — штрафує (контроль)', () => {
    const md = `# f\n\n## Огляд\n\nОгляд, пропуская деталі.\n\n## Поведінка\n\nКрок.\n`
    expect(scoreDoc(md, FACTS).issues).toContain('surzhik')
  })
})
