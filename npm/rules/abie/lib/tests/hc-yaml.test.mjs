/**
 * Тести для validateAbieHcModeline: перевіряє modeline `# yaml-language-server: $schema=...`
 * у `hc.yaml`. Усі гілки покриті: empty-первая-рядок, нема modeline, неправильний schema, OK,
 * BOM-префікс, CRLF-newlines.
 */
import { describe, expect, test } from 'vitest'

import { ABIE_HC_SCHEMA_URL, validateAbieHcModeline } from '../hc-yaml.mjs'

const REL_PATH = 'k8s/foo/hc.yaml'

describe('ABIE_HC_SCHEMA_URL', () => {
  test('має канонічний CRDs-catalog URL для HealthCheckPolicy v1', () => {
    expect(ABIE_HC_SCHEMA_URL).toBe(
      'https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json'
    )
  })
})

describe('validateAbieHcModeline', () => {
  test('OK: коректний modeline → null', () => {
    const raw = `# yaml-language-server: $schema=${ABIE_HC_SCHEMA_URL}\napiVersion: networking.gke.io/v1\nkind: HealthCheckPolicy\n`
    expect(validateAbieHcModeline(raw, REL_PATH)).toBeNull()
  })

  test('перший рядок порожній → помилка про "перший рядок порожній"', () => {
    const raw = '\napiVersion: networking.gke.io/v1\n'
    expect(validateAbieHcModeline(raw, REL_PATH)).toBe(
      `${REL_PATH}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)`
    )
  })

  test('перший рядок тільки whitespace → той самий empty-error', () => {
    expect(validateAbieHcModeline('   \napiVersion: x\n', REL_PATH)).toContain('перший рядок порожній')
  })

  test('перший рядок не modeline → помилка про modeline', () => {
    const raw = 'apiVersion: networking.gke.io/v1\nkind: HealthCheckPolicy\n'
    expect(validateAbieHcModeline(raw, REL_PATH)).toBe(`${REL_PATH}: перший рядок має бути modeline $schema (abie.mdc)`)
  })

  test('modeline з неправильним $schema URL → помилка з правильним URL', () => {
    const raw = '# yaml-language-server: $schema=https://example.com/wrong.json\napiVersion: x\n'
    const err = validateAbieHcModeline(raw, REL_PATH)
    expect(err).toContain(`${REL_PATH}: $schema має бути`)
    expect(err).toContain(ABIE_HC_SCHEMA_URL)
    expect(err).toContain('(abie.mdc)')
  })

  test('CRLF-newlines теж парсяться', () => {
    const raw = `# yaml-language-server: $schema=${ABIE_HC_SCHEMA_URL}\r\napiVersion: x\r\n`
    expect(validateAbieHcModeline(raw, REL_PATH)).toBeNull()
  })

  test('BOM-префікс прибирається перед валідацією', () => {
    const raw = `﻿# yaml-language-server: $schema=${ABIE_HC_SCHEMA_URL}\napiVersion: x\n`
    expect(validateAbieHcModeline(raw, REL_PATH)).toBeNull()
  })

  test('повністю порожній файл → empty-error (lines=[""], перший trim==="")', () => {
    expect(validateAbieHcModeline('', REL_PATH)).toContain('перший рядок порожній')
  })

  test('relPath включається в повідомлення для всіх помилок', () => {
    const customPath = 'pkg-x/k8s/hc.yaml'
    expect(validateAbieHcModeline('', customPath)).toMatch(/^pkg-x\/k8s\/hc\.yaml:/u)
    expect(validateAbieHcModeline('foo\n', customPath)).toMatch(/^pkg-x\/k8s\/hc\.yaml:/u)
    expect(validateAbieHcModeline('# yaml-language-server: $schema=https://x.json\n', customPath)).toMatch(
      /^pkg-x\/k8s\/hc\.yaml:/u
    )
  })
})
