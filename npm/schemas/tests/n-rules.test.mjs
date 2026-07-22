/**
 * Тест схеми `npm/schemas/n-rules.json` — `storybook`-об'єкт (`detectApps`/`optOut`)
 * додано за результатами живого пілота app-скафолда на gt: без нього
 * `storybook.detectApps`/`storybook.optOut` у `.n-rules.json` консюмера — невідоме поле
 * під `additionalProperties: false` кореневої схеми, і v8r-схема-валідація (`text/run-v8r`)
 * відкидає такий конфіг як невалідний. Тест — read-only, лише структура схеми (без реального
 * запуску v8r/ajv — той конвеєр уже покритий `npm/rules/text/run-v8r/tests`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SCHEMA_PATH = join(import.meta.dirname, '..', 'n-rules.json')
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))

describe('n-rules.json schema: storybook', () => {
  test('кореневий properties.storybook — object, additionalProperties: false', () => {
    const storybook = schema.properties.storybook
    expect(storybook).toBeDefined()
    expect(storybook.type).toBe('object')
    expect(storybook.additionalProperties).toBe(false)
  })

  test('storybook.detectApps — boolean, default false', () => {
    const detectApps = schema.properties.storybook.properties.detectApps
    expect(detectApps.type).toBe('boolean')
    expect(detectApps.default).toBe(false)
  })

  test('storybook.optOut — масив непорожніх рядків', () => {
    const optOut = schema.properties.storybook.properties.optOut
    expect(optOut.type).toBe('array')
    expect(optOut.items.type).toBe('string')
    expect(optOut.items.minLength).toBe(1)
  })

  test('storybook — єдині дозволені поля: detectApps, optOut (typo не пройде мовчки)', () => {
    expect(Object.keys(schema.properties.storybook.properties).toSorted()).toEqual(['detectApps', 'optOut'])
  })

  test('кореневий $schema лишається additionalProperties: false — storybook мав би інакше мовчки відкидатись', () => {
    expect(schema.additionalProperties).toBe(false)
  })
})
