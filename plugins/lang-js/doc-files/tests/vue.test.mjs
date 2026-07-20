import { describe, expect, test } from 'vitest'

import { extractFactsVue, extractUnitsVue } from '../vue.mjs'

const facts = (src, relPath = 'X.vue') => extractFactsVue(src, relPath)
const exportNames = f => f.exports.map(e => e.name)
const exportByName = (f, name) => f.exports.find(e => e.name === name)

describe('extractFactsVue — object-based defineProps', () => {
  const SFC = `<script setup>
const props = defineProps({
  /** Заголовок картки */
  title: { type: String, required: true },
  count: { type: Number, default: 0 }
})
</script>`

  test('props потрапляють у exports з kind=prop', () => {
    const f = facts(SFC)
    expect(exportNames(f)).toEqual(expect.arrayContaining(['title', 'count']))
    expect(exportByName(f, 'title').kind).toBe('prop')
  })

  test('JSDoc над полем стає desc; поле без JSDoc — desc порожній (Stage 2 gap)', () => {
    const f = facts(SFC)
    expect(exportByName(f, 'title').desc).toBe('Заголовок картки')
    expect(exportByName(f, 'count').desc).toBe('')
  })
})

describe('extractFactsVue — generic defineProps<Props>() (окрема interface-декларація)', () => {
  const SFC = `<script setup lang="ts">
interface Props {
  /** Заголовок картки */
  title: string
  count?: number
}
const props = defineProps<Props>()
</script>`

  test('JSDoc над полем типу резолвиться через імʼя інтерфейсу', () => {
    const f = facts(SFC)
    expect(exportByName(f, 'title').desc).toBe('Заголовок картки')
    expect(exportByName(f, 'count').desc).toBe('')
  })
})

describe('extractFactsVue — defineEmits', () => {
  test('масив рядків: defineEmits([...])', () => {
    const f = facts(`<script setup>\nconst emit = defineEmits(['save', 'cancel'])\n</script>`)
    expect(exportNames(f)).toEqual(expect.arrayContaining(['save', 'cancel']))
    expect(exportByName(f, 'save').kind).toBe('emit')
  })

  test('типовий літерал: defineEmits<{ (e: "x"): void }>()', () => {
    const f = facts(
      `<script setup lang="ts">\nconst emit = defineEmits<{ (e: 'save', id: string): void; (e: 'cancel'): void }>()\n</script>`
    )
    expect(exportNames(f)).toEqual(expect.arrayContaining(['save', 'cancel']))
  })
})

describe('extractFactsVue — defineExpose', () => {
  test('shorthand-ключі об’єктного літерала стають exports з kind=exposed', () => {
    const f = facts(`<script setup>\nfunction reset() {}\ndefineExpose({ reset })\n</script>`)
    expect(exportByName(f, 'reset').kind).toBe('exposed')
  })
})

describe('extractFactsVue — @slot коментарі шаблону', () => {
  test('<!-- @slot name опис --> потрапляє у facts.slots', () => {
    const f = facts(
      `<template>\n  <!-- @slot header Заголовок картки -->\n  <slot name="header" />\n</template>\n<script setup>\nconst x = 1\n</script>`
    )
    expect(f.slots).toEqual([{ name: 'header', desc: 'Заголовок картки' }])
  })
})

describe('extractFactsVue — header не протікає з <template>', () => {
  test('провідний JSDoc script-блоку → header; текст template не впливає', () => {
    const f = facts(
      `<template>\n  <!-- звичайний коментар шаблону -->\n  <div />\n</template>\n<script setup>\n/**\n * Опис компонента.\n */\nconst props = defineProps<{ title: string }>()\n</script>`
    )
    expect(f.header).toBe('Опис компонента.')
  })
})

describe('extractFactsVue — файл без <script>', () => {
  test('unsupported: true, без краху', () => {
    const f = facts('<template><div>hi</div></template>')
    expect(f.unsupported).toBe(true)
    expect(f.exports).toEqual([])
  })
})

describe('extractUnitsVue — офсети зміщені на позицію script-блоку у файлі', () => {
  test('span вказує на функцію у повному тексті файлу, не у script.content', () => {
    const src = `<template><div /></template>\n<script setup>\nfunction reset() {}\n</script>\n`
    const units = extractUnitsVue(src, 'X.vue')
    expect(units).not.toBeNull()
    const unit = units.find(u => u.name === 'reset')
    expect(src.slice(unit.span.start, unit.span.end)).toBe('function reset() {}')
  })
})
