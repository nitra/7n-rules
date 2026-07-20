import { describe, expect, test } from 'vitest'

import { extractFacts } from '../extractors.mjs'
import { extractUnitsVue } from '../vue.mjs'
import { extractUnitsJs } from '../units-js.mjs'

// Фікстури зібрані динамічно (шаблонні літерали), не файлами — щоб T0/LLM-автофікси
// лінта не переписували патерни всередині тестових SFC.
const sfc = (script, { lang = '', template = '<div />', setup = true } = {}) => {
  const attrs = [setup ? ' setup' : '', lang ? ` lang="${lang}"` : ''].join('')
  return `<template>\n  ${template}\n</template>\n\n<script${attrs}>\n${script}\n</script>\n`
}

describe('extractFactsVue (через диспетчер extractFacts)', () => {
  test('generic defineProps<Props> + JSDoc-описи членів interface', () => {
    const script = [
      '/** Компонент-приклад: редагує одну назву. */',
      'interface Props {',
      '  /** поточне значення назви */',
      '  modelValue: string',
      '  /** максимально дозволена довжина */',
      '  maxLength?: number',
      '}',
      'const props = defineProps<Props>()'
    ].join('\n')
    const facts = extractFacts(sfc(script, { lang: 'ts' }), 'components/NameInput.vue')

    expect(facts.unsupported).toBeUndefined()
    expect(facts.lang).toBe('vue')
    expect(facts.header).toContain('редагує одну назву')
    const names = facts.exports.filter(e => e.kind === 'prop').map(e => e.name)
    expect(names.toSorted()).toEqual(['maxLength', 'modelValue'])
    expect(facts.exports.find(e => e.name === 'modelValue').desc).toBe('поточне значення назви')
    expect(facts.exports.find(e => e.name === 'maxLength').desc).toBe('максимально дозволена довжина')
  })

  test('обʼєктна форма defineProps + JSDoc над ключем', () => {
    const script = [
      'const props = defineProps({',
      '  /** адреса аватарки */',
      '  avatarUrl: String,',
      '  size: { type: Number, default: 32 }',
      '})'
    ].join('\n')
    const facts = extractFacts(sfc(script), 'components/Avatar.vue')

    const props = facts.exports.filter(e => e.kind === 'prop')
    expect(props.map(p => p.name).toSorted()).toEqual(['avatarUrl', 'size'])
    expect(props.find(p => p.name === 'avatarUrl').desc).toBe('адреса аватарки')
    expect(props.find(p => p.name === 'size').desc).toBe('')
  })

  test('defineEmits: function-signature generic і масив-форма', () => {
    const generic = "const emit = defineEmits<{ (e: 'save', id: number): void; (e: 'cancel'): void }>()"
    const genericFacts = extractFacts(sfc(generic, { lang: 'ts' }), 'a.vue')
    expect(
      genericFacts.exports
        .filter(e => e.kind === 'emit')
        .map(e => e.name)
        .toSorted()
    ).toEqual(['cancel', 'save'])

    const arr = "const emit = defineEmits(['update:modelValue', 'close'])"
    const arrFacts = extractFacts(sfc(arr), 'b.vue')
    expect(
      arrFacts.exports
        .filter(e => e.kind === 'emit')
        .map(e => e.name)
        .toSorted()
    ).toEqual(['close', 'update:modelValue'])
  })

  test('defineEmits: object-style generic — ключі з tuple, а не label-и', () => {
    const script = 'const emit = defineEmits<{ save: [id: number]; close: [] }>()'
    const facts = extractFacts(sfc(script, { lang: 'ts' }), 'c.vue')
    expect(
      facts.exports
        .filter(e => e.kind === 'emit')
        .map(e => e.name)
        .toSorted()
    ).toEqual(['close', 'save'])
    expect(facts.exports.some(e => e.name === 'id')).toBe(false)
  })

  test('defineExpose і слоти з <!-- @slot --> у template', () => {
    const script = ['function focus() {}', 'const version = 3', 'defineExpose({ focus, version })'].join('\n')
    const template = '<div>\n  <!-- @slot header: шапка картки -->\n  <slot name="header" />\n</div>'
    const facts = extractFacts(sfc(script, { template }), 'Card.vue')

    expect(
      facts.exports
        .filter(e => e.kind === 'expose')
        .map(e => e.name)
        .toSorted()
    ).toEqual(['focus', 'version'])
    expect(facts.slots).toEqual([{ name: 'header', desc: 'шапка картки' }])
  })

  test('template без script-блоку → unsupported (whole-file фолбек)', () => {
    const facts = extractFacts('<template>\n  <div>static</div>\n</template>\n', 'Static.vue')
    expect(facts.unsupported).toBe(true)
    expect(facts.lang).toBe('vue')
  })

  test('header не протікає з template; markers рахуються лише по script', () => {
    const script = "import { writeFileSync } from 'node:fs'\nwriteFileSync('x', 'y')"
    const template = '<div>fetch https://example.com</div>'
    const facts = extractFacts(sfc(script, { template }), 'W.vue')
    expect(facts.header).toBe('')
    expect(facts.markers.readOnly).toBe(false)
    expect(facts.markers.network).toBe(false)
  })
})

describe('extractUnitsVue', () => {
  test('span-и юнітів вказують на позиції в оригінальному .vue', () => {
    const script = ['function localHelper() {', "  return 'x'", '}'].join('\n')
    const src = sfc(script)
    const units = extractUnitsVue(src, 'U.vue', extractUnitsJs)

    expect(units).toHaveLength(1)
    const u = units[0]
    expect(u.name).toBe('localHelper')
    expect(src.slice(u.span.start, u.span.end)).toBe(u.body)
  })

  test('без script-блоку → null', () => {
    expect(extractUnitsVue('<template><i /></template>', 'N.vue', extractUnitsJs)).toBeNull()
  })
})
