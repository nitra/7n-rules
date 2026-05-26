import { describe, expect, test } from 'vitest'

import { abieEnvNameFromBasename, validateAbieEnvInternalUrls } from '../env-dns.mjs'

describe('abieEnvNameFromBasename', () => {
  test('лише dev/ua (з опційною провідною крапкою)', () => {
    expect(abieEnvNameFromBasename('dev.env')).toBe('dev')
    expect(abieEnvNameFromBasename('.dev.env')).toBe('dev')
    expect(abieEnvNameFromBasename('ua.env')).toBe('ua')
    expect(abieEnvNameFromBasename('.ua.env')).toBe('ua')
    expect(abieEnvNameFromBasename('production.env')).toBeNull()
    expect(abieEnvNameFromBasename('.env')).toBeNull()
    expect(abieEnvNameFromBasename('dev.env.example')).toBeNull()
  })
})

describe('validateAbieEnvInternalUrls', () => {
  test('узгоджений dev URL (Hasura + KVCMS) — без помилок', () => {
    const env = `HASURA_GRAPHQL_ENDPOINT=http://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080
KVCMS_URL=http://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080
`
    expect(validateAbieEnvInternalUrls(env, 'dev')).toEqual([])
  })

  test('ua URL без порту також ловиться', () => {
    const env = `KVCMS_URL=http://kvcms-hl.ua-apruv.svc.abie-ua.internal\n`
    expect(validateAbieEnvInternalUrls(env, 'ua')).toEqual([])
  })

  test('некоректний кластер для env (dev URL у .ua.env) — fail', () => {
    const env = `KVCMS_URL=http://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080\n`
    const errs = validateAbieEnvInternalUrls(env, 'ua')
    expect(errs.length).toBeGreaterThanOrEqual(2)
    expect(errs.some(e => e.includes('abie-ua.internal'))).toBe(true)
    expect(errs.some(e => e.includes('ua-'))).toBe(true)
  })

  test('не торкається публічних/зовнішніх URL', () => {
    const env = `EXTERNAL=https://example.com/contract/ql\nLOCAL=http://localhost:8080\n`
    expect(validateAbieEnvInternalUrls(env, 'dev')).toEqual([])
  })

  test('кілька URL з різними порушеннями', () => {
    const env = `A=http://a-hl.dev-foo.svc.abie-dev.internal:8080
B=http://b-hl.ua-foo.svc.abie-ua.internal:8080
`
    const errs = validateAbieEnvInternalUrls(env, 'ua')
    expect(errs.length).toBe(2) // 1 URL × 2 проблеми (DNS + namespace)
  })
})
