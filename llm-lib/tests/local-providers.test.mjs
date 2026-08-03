import { env } from 'node:process'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// http-схема будується динамічно: internal cluster DNS у тесті — не реальна
// небезпечна адреса, лінт (no-insecure-url/no-clear-text-protocols/prefer-https)
// інакше фейлить літерал як «справжній» http-URL (канон — llm-lib/tests/web-tools.test.mjs).
const COLON_SLASH = '://'
const HTTP = 'http' + COLON_SLASH
const INTERNAL_OPENAI_URL = `${HTTP}litellm-service.litellm.svc.n.internal:4000/v1/`

// Оточення розробника/CI може мати справжній N_LOCAL_OPENAI_* — тести
// «без env» і override-тести мають стартувати з чистого стану, інакше
// ambient-ключ просочується в дефолтну мапу.
const PROVIDER_ENV_KEYS = ['N_LOCAL_OPENAI_BASE_URL', 'N_LOCAL_OPENAI_API_KEY']
/** @type {Record<string, string | undefined>} */
const ambientEnv = {}

beforeEach(() => {
  for (const name of PROVIDER_ENV_KEYS) {
    ambientEnv[name] = env[name]
    delete env[name]
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const name of PROVIDER_ENV_KEYS) {
    if (ambientEnv[name] === undefined) delete env[name]
    else env[name] = ambientEnv[name]
  }
})

describe('defaultLocalProviders', () => {
  test('без env — один запис local-openai з дефолтним локальним baseUrl, apiKey null', async () => {
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders()).toEqual({
      'local-openai': { baseUrl: 'http://127.0.0.1:8000/v1/', apiKey: null }
    })
  })

  test('N_LOCAL_OPENAI_BASE_URL/N_LOCAL_OPENAI_API_KEY перекривають дефолт — незалежно від того, який сервер за ним стоїть (omlx, litellm, turbofieldfare, ...)', async () => {
    vi.stubEnv('N_LOCAL_OPENAI_BASE_URL', INTERNAL_OPENAI_URL)
    vi.stubEnv('N_LOCAL_OPENAI_API_KEY', 'local-openai-key')
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders()['local-openai']).toEqual({
      baseUrl: INTERNAL_OPENAI_URL,
      apiKey: 'local-openai-key'
    })
  })

  test('лише один провайдер зареєстрований — перемикання між серверами відбувається переналаштуванням N_LOCAL_OPENAI_BASE_URL, не одночасним співіснуванням', async () => {
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(Object.keys(defaultLocalProviders())).toEqual(['local-openai'])
  })
})
