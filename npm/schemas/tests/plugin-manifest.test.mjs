/**
 * Тест схеми `npm/schemas/plugin-manifest.json` (блок package.json#n-rules, universal typed slot
 * bus, spec 2026-07-27-universal-plugin-slots-lang-php-extraction). На відміну від
 * `n-rules.test.mjs` (лише структура схеми — той конвеєр вже покритий `run-v8r/tests`), тут
 * додатково прогнано ajv за коректними і хибними зразками manifest-блоку: ця схема НЕ
 * зареєстрована у v8r-catalog.json (fileMatch на package.json уже зайнятий загальною
 * vendor/package.json-схемою — другий catalog-запис перебив би її), тож єдина автоматична
 * перевірка самої схеми — цей тест.
 */
import Ajv from 'ajv'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SCHEMA_PATH = join(import.meta.dirname, '..', 'plugin-manifest.json')
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))

const ajv = new Ajv({ strict: false })
const validate = ajv.compile(schema)

/** Мінімальний валідний manifest — лише обовʼязкове поле. */
const MINIMAL_VALID = { requiresPluginApi: 2 }

/** Повний валідний manifest — capabilities, resource-contribution, value-contribution, consumer. */
const FULL_VALID = {
  requiresPluginApi: 2,
  capabilities: ['lang:php'],
  slots: {
    provides: [
      { slot: 'rules.directory', version: 1, id: 'php-rules', resource: './rules' },
      {
        slot: 'ci.artifact',
        version: 1,
        id: 'php-github-lint',
        resource: './slots/ci/php-github-lint.json',
        requires: { capabilities: ['ci:github'] }
      },
      { slot: 'doc-files.extensions', version: 1, id: 'ext', value: { '.php': 'PHP Module' } }
    ],
    consumes: [{ slot: 'ci.artifact', versions: [1], handler: './slots/ci-artifact-consumer.mjs' }]
  }
}

describe('plugin-manifest.json schema: структура', () => {
  test('кореневий — object, additionalProperties: false, required requiresPluginApi', () => {
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['requiresPluginApi'])
  })

  test('slots — object, additionalProperties: false, лише provides/consumes', () => {
    const slots = schema.properties.slots
    expect(slots.type).toBe('object')
    expect(slots.additionalProperties).toBe(false)
    expect(Object.keys(slots.properties).toSorted()).toEqual(['consumes', 'provides'])
  })

  test('contribution — рівно одне з resource/value через oneOf, priority/before/after відсутні у properties (заборонені additionalProperties:false)', () => {
    const contribution = schema.definitions.contribution
    expect(contribution.additionalProperties).toBe(false)
    expect(contribution.oneOf).toHaveLength(2)
    const propNames = Object.keys(contribution.properties)
    expect(propNames).not.toContain('priority')
    expect(propNames).not.toContain('before')
    expect(propNames).not.toContain('after')
  })

  test('consumer — required slot/versions/handler', () => {
    expect(schema.definitions.consumer.required.toSorted()).toEqual(['handler', 'slot', 'versions'])
  })
})

describe('plugin-manifest.json schema: ajv-валідація зразків', () => {
  test('мінімальний валідний manifest проходить', () => {
    expect(validate(MINIMAL_VALID)).toBe(true)
  })

  test('повний валідний manifest (resource + value contributions, requires.capabilities, consumer) проходить', () => {
    expect(validate(FULL_VALID)).toBe(true)
  })

  test('без requiresPluginApi — invalid', () => {
    expect(validate({ capabilities: [] })).toBe(false)
  })

  test('requiresPluginApi не integer — invalid', () => {
    expect(validate({ requiresPluginApi: '2' })).toBe(false)
  })

  test('contribution без slot/version/id — invalid', () => {
    expect(validate({ requiresPluginApi: 2, slots: { provides: [{ value: 1 }] } })).toBe(false)
  })

  test('contribution з resource І value одночасно — invalid (oneOf)', () => {
    const manifest = {
      requiresPluginApi: 2,
      slots: { provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: './r.json', value: 1 }] }
    }
    expect(validate(manifest)).toBe(false)
  })

  test('contribution ні з resource, ні з value — invalid (oneOf)', () => {
    const manifest = { requiresPluginApi: 2, slots: { provides: [{ slot: 'demo.widget', version: 1, id: 'w' }] } }
    expect(validate(manifest)).toBe(false)
  })

  test('contribution з priority — invalid (additionalProperties: false)', () => {
    const manifest = {
      requiresPluginApi: 2,
      slots: { provides: [{ slot: 'demo.widget', version: 1, id: 'w', value: 1, priority: 1 }] }
    }
    expect(validate(manifest)).toBe(false)
  })

  test('slot з одним сегментом (без крапки/дефіса) — invalid (pattern)', () => {
    const manifest = { requiresPluginApi: 2, slots: { provides: [{ slot: 'widget', version: 1, id: 'w', value: 1 }] } }
    expect(validate(manifest)).toBe(false)
  })

  test('id з великими літерами — invalid (pattern)', () => {
    const manifest = {
      requiresPluginApi: 2,
      slots: { provides: [{ slot: 'demo.widget', version: 1, id: 'BadId', value: 1 }] }
    }
    expect(validate(manifest)).toBe(false)
  })

  test('resource без префікса "./" — invalid (pattern)', () => {
    const manifest = {
      requiresPluginApi: 2,
      slots: { provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: 'r.json' }] }
    }
    expect(validate(manifest)).toBe(false)
  })

  test('consumer з порожнім versions — invalid (minItems)', () => {
    const manifest = {
      requiresPluginApi: 2,
      slots: { consumes: [{ slot: 'demo.widget', versions: [], handler: './h.mjs' }] }
    }
    expect(validate(manifest)).toBe(false)
  })

  test('consumer з дублікатами versions — invalid (uniqueItems)', () => {
    const manifest = {
      requiresPluginApi: 2,
      slots: { consumes: [{ slot: 'demo.widget', versions: [1, 1], handler: './h.mjs' }] }
    }
    expect(validate(manifest)).toBe(false)
  })

  test('невідоме top-level поле — invalid (additionalProperties: false)', () => {
    expect(validate({ requiresPluginApi: 2, contributes: { rules: true } })).toBe(false)
  })
})
