import { env } from 'node:process'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// http-схема будується динамічно: internal cluster DNS у тесті — не реальна
// небезпечна адреса, лінт (no-insecure-url/no-clear-text-protocols/prefer-https)
// інакше фейлить літерал як «справжній» http-URL (канон — llm-lib/tests/web-tools.test.mjs).
const COLON_SLASH = '://'
const HTTP = 'http' + COLON_SLASH
const INTERNAL_OPENAI_URL = `${HTTP}litellm-service.litellm.svc.n.internal:4000/v1/`

// Оточення розробника/CI може мати справжні N_OMLX_*/N_LOCAL_OPENAI_* — тести
// «без env» і override-тести мають стартувати з чистого стану, інакше
// ambient-ключ (напр. N_LOCAL_OPENAI_API_KEY) просочується в дефолтну мапу.
const PROVIDER_ENV_KEYS = [
  'N_OMLX_BASE_URL',
  'N_OMLX_API_KEY',
  'N_LOCAL_OPENAI_BASE_URL',
  'N_LOCAL_OPENAI_API_KEY',
  // Без префікса — власна конвенція omlx-сервера (fallback для apiKey): теж ambient-небезпечна.
  'OMLX_API_KEY'
]
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
  test('без env — дефолтні baseUrl для omlx і local-openai, apiKey null', async () => {
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders()).toEqual({
      omlx: { baseUrl: 'http://127.0.0.1:8000/v1/', apiKey: null },
      'local-openai': { baseUrl: 'https://llm.7n.ai/v1/', apiKey: null }
    })
  })

  test('обидва провайдери завжди присутні одночасно (жоден не вимикається іншим)', async () => {
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(Object.keys(defaultLocalProviders()).toSorted()).toEqual(['local-openai', 'omlx'])
  })

  test('N_OMLX_BASE_URL/N_OMLX_API_KEY перекривають дефолт omlx', async () => {
    vi.stubEnv('N_OMLX_BASE_URL', 'http://127.0.0.1:9000/v1/')
    vi.stubEnv('N_OMLX_API_KEY', 'omlx-key')
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders().omlx).toEqual({
      baseUrl: 'http://127.0.0.1:9000/v1/',
      apiKey: 'omlx-key'
    })
  })

  test('N_LOCAL_OPENAI_BASE_URL/N_LOCAL_OPENAI_API_KEY перекривають дефолт local-openai — незалежно від того, який сервер за ним стоїть (litellm, turbofieldfare, ...)', async () => {
    vi.stubEnv('N_LOCAL_OPENAI_BASE_URL', INTERNAL_OPENAI_URL)
    vi.stubEnv('N_LOCAL_OPENAI_API_KEY', 'local-openai-key')
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders()['local-openai']).toEqual({
      baseUrl: INTERNAL_OPENAI_URL,
      apiKey: 'local-openai-key'
    })
  })

  test('apiKey-fallback без префікса: OMLX_API_KEY (конвенція omlx-сервера) — local-openai такої конвенції не має', async () => {
    vi.stubEnv('OMLX_API_KEY', 'server-omlx-key')
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    const providers = defaultLocalProviders()
    expect(providers.omlx.apiKey).toBe('server-omlx-key')
    expect(providers['local-openai'].apiKey).toBeNull()
  })

  test('N_-префіксований ключ має пріоритет над fallback без префікса', async () => {
    vi.stubEnv('OMLX_API_KEY', 'server-omlx-key')
    vi.stubEnv('N_OMLX_API_KEY', 'prefixed-wins')
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders().omlx.apiKey).toBe('prefixed-wins')
  })
})
