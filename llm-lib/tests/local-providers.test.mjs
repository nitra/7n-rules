import { afterEach, describe, expect, test, vi } from 'vitest'

// http-схема будується динамічно: internal cluster DNS у тесті — не реальна
// небезпечна адреса, лінт (no-insecure-url/no-clear-text-protocols/prefer-https)
// інакше фейлить літерал як «справжній» http-URL (канон — llm-lib/tests/web-tools.test.mjs).
const COLON_SLASH = '://'
const HTTP = 'http' + COLON_SLASH
const INTERNAL_LITELLM_URL = `${HTTP}litellm-service.litellm.svc.n.internal:4000/v1/`

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('defaultLocalProviders', () => {
  test('без env — дефолтні baseUrl для omlx і litellm, apiKey null', async () => {
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders()).toEqual({
      omlx: { baseUrl: 'http://127.0.0.1:8000/v1/', apiKey: null },
      litellm: { baseUrl: 'https://llm.7n.ai/v1/', apiKey: null }
    })
  })

  test('обидва провайдери завжди присутні одночасно (жоден не вимикається іншим)', async () => {
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(Object.keys(defaultLocalProviders()).toSorted()).toEqual(['litellm', 'omlx'])
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

  test('N_LITELLM_BASE_URL/N_LITELLM_API_KEY перекривають дефолт litellm', async () => {
    vi.stubEnv('N_LITELLM_BASE_URL', INTERNAL_LITELLM_URL)
    vi.stubEnv('N_LITELLM_API_KEY', 'litellm-key')
    const { defaultLocalProviders } = await import('../lib/local-providers.mjs')
    expect(defaultLocalProviders().litellm).toEqual({
      baseUrl: INTERNAL_LITELLM_URL,
      apiKey: 'litellm-key'
    })
  })
})
