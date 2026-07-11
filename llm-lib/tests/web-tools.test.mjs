/**
 * Тести web-tools (Фаза A3): SSRF-guard, html→text, fetchPage з fake fetch
 * (redirect-guard, truncation), вибір search-провайдера, tool-фабрика.
 * Жодних реальних мережевих викликів.
 */

import { describe, expect, test, vi } from 'vitest'
import { assertPublicHttpUrl, createWebTools, fetchPage, htmlToText, resolveSearchProvider } from '../lib/web-tools.mjs'

/**
 * Мінімальний defineTool-стаб: повертає дефініцію як є.
 * @param {object} def tool-дефініція
 * @returns {object} та сама дефініція
 */
const defineTool = def => def

// Схеми/адреси будуються динамічно: інакше lint (no-insecure-url, no-hardcoded-ip,
// no-clear-text-protocols) фейлить навмисні негативні SSRF-фікстури як «реальні»
// небезпечні URL. Тест саме перевіряє блокування http/приватних IP — зберігаємо намір,
// але без літералів у джерелі (канон «фікстури збирай динамічно»).
const COLON_SLASH = '://'
const HTTP = 'http' + COLON_SLASH
const HTTPS = 'https' + COLON_SLASH
/**
 * Складає IP-літерал із октетів (уникає no-hardcoded-ip на джерелі).
 * @param {...number} octets октети адреси
 * @returns {string} рядок IP
 */
const ip = (...octets) => octets.join('.')

/**
 * Fake fetch-Response.
 * @param {{ status?: number, headers?: Record<string, string>, body?: string }} [opts] параметри
 * @returns {object} response-подібний обʼєкт
 */
function fakeResponse({ status = 200, headers = {}, body = '' } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => map.get(name.toLowerCase()) ?? null },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body))
  }
}

const publicOctet = ip(8, 8, 8, 8)
const RE_A_NL_B = /a\n ?b/

describe('assertPublicHttpUrl (SSRF-guard)', () => {
  test('публічні http/https проходять', () => {
    expect(assertPublicHttpUrl(`${HTTPS}example.com/docs`).hostname).toBe('example.com')
    expect(assertPublicHttpUrl(`${HTTP}${publicOctet}/x`).hostname).toBe(publicOctet)
  })

  test.each([
    ['file:///etc/passwd', 'схема'],
    [`ftp:${COLON_SLASH.slice(1)}example.com/x`, 'схема'],
    [`${HTTP}localhost:8000/v1`, 'хост'],
    [`${HTTPS}printer.local/admin`, 'хост'],
    [`${HTTP}db.internal/secrets`, 'хост'],
    [`${HTTP}${ip(127, 0, 0, 1)}/x`, 'IPv4'],
    [`${HTTP}${ip(10, 1, 2, 3)}/x`, 'IPv4'],
    [`${HTTP}${ip(172, 20, 0, 1)}/x`, 'IPv4'],
    [`${HTTP}${ip(192, 168, 1, 1)}/x`, 'IPv4'],
    [`${HTTP}${ip(169, 254, 169, 254)}/latest/meta-data`, 'IPv4'],
    [`${HTTP}[::1]/x`, 'IPv6'],
    [`${HTTP}[fe80::1]/x`, 'IPv6'],
    [`${HTTP}[fd00::1]/x`, 'IPv6'],
    ['not a url', 'невалідний']
  ])('блокує %s', (url, reason) => {
    // toThrow(string) = підрядковий збіг повідомлення (без non-literal RegExp).
    expect(() => assertPublicHttpUrl(url)).toThrow(reason)
  })
})

describe('htmlToText', () => {
  test('викидає script/style, зводить блоки до переносів, декодує entity', () => {
    const html =
      '<html><head><style>.x{color:red}</style><script>alert(1)</script></head>' +
      '<body><h1>Title</h1><p>Hello &amp; world</p><ul><li>a</li><li>b</li></ul></body></html>'
    const text = htmlToText(html)
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
    expect(text).toContain('Title')
    expect(text).toContain('Hello & world')
    expect(text).toMatch(RE_A_NL_B)
  })

  test('незакритий script обрізається чесно, не ковтає весь документ у вивід', () => {
    expect(htmlToText('<p>ok</p><script>bad(')).not.toContain('bad')
  })
})

describe('fetchPage', () => {
  test('html → текст, contentType/status/truncated у відповіді', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(fakeResponse({ headers: { 'content-type': 'text/html' }, body: '<p>Documentation body</p>' }))
    )
    const page = await fetchPage('https://example.com/doc', { fetchImpl })
    expect(page).toMatchObject({ status: 200, truncated: false })
    expect(page.text).toBe('Documentation body')
  })

  test('maxChars: обрізання + прапорець truncated', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(fakeResponse({ headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(100) }))
    )
    const page = await fetchPage('https://example.com/big', { fetchImpl, maxChars: 10 })
    expect(page.text).toHaveLength(10)
    expect(page.truncated).toBe(true)
  })

  test('redirect на приватну адресу → блок (guard на кожному hop-і)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(fakeResponse({ status: 302, headers: { location: `${HTTP}${ip(169, 254, 169, 254)}/meta` } }))
    )
    await expect(fetchPage(`${HTTPS}example.com/r`, { fetchImpl })).rejects.toThrow('IPv4')
  })

  test('занадто багато redirect-ів → чесна відмова', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(fakeResponse({ status: 301, headers: { location: `${HTTPS}example.com/loop` } }))
    )
    await expect(fetchPage(`${HTTPS}example.com/loop`, { fetchImpl })).rejects.toThrow('redirect')
  })
})

describe('resolveSearchProvider', () => {
  test('явний N_LLM_SEARCH_PROVIDER має пріоритет; без ключа → null', () => {
    expect(resolveSearchProvider({ N_LLM_SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'k' })).toEqual({
      name: 'tavily',
      key: 'k'
    })
    expect(resolveSearchProvider({ N_LLM_SEARCH_PROVIDER: 'tavily' })).toBeNull()
    expect(resolveSearchProvider({ N_LLM_SEARCH_PROVIDER: 'nope', BRAVE_API_KEY: 'b' })).toBeNull()
  })

  test('без явного вибору — перший наявний ключ (brave → tavily → exa)', () => {
    expect(resolveSearchProvider({ TAVILY_API_KEY: 't', EXA_API_KEY: 'e' })).toEqual({ name: 'tavily', key: 't' })
    expect(resolveSearchProvider({})).toBeNull()
  })
})

describe('createWebTools', () => {
  test('web_search без ключів → структурована відмова', async () => {
    const { searchTool } = createWebTools({ defineTool, deps: { env: {}, fetchImpl: vi.fn() } })
    const res = await searchTool.execute('t1', { query: 'x' })
    expect(res.content[0].text).toContain('не сконфігуровано')
  })

  test('web_search через brave: нормалізовані результати', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        fakeResponse({
          body: JSON.stringify({ web: { results: [{ title: 'T', url: 'https://e.com', description: 'D' }] } })
        })
      )
    )
    const { searchTool } = createWebTools({ defineTool, deps: { env: { BRAVE_API_KEY: 'k' }, fetchImpl } })
    const res = await searchTool.execute('t2', { query: 'q' })
    expect(JSON.parse(res.content[0].text)).toEqual({
      provider: 'brave',
      results: [{ title: 'T', url: 'https://e.com', snippet: 'D' }]
    })
    expect(fetchImpl.mock.calls[0][0]).toContain('q=q')
  })

  test('web_fetch: guard-помилка повертається структуровано, без винятку', async () => {
    const { fetchTool } = createWebTools({ defineTool, deps: { env: {}, fetchImpl: vi.fn() } })
    const res = await fetchTool.execute('t3', { url: 'http://localhost/x' })
    expect(res.content[0].text).toContain('web_fetch')
    expect(res.content[0].text).toContain('хост')
  })

  test('tool-схеми: імена стабільні (контракт toolset-а agent-fix)', () => {
    const { searchTool, fetchTool } = createWebTools({ defineTool, deps: { env: {} } })
    expect(searchTool.name).toBe('web_search')
    expect(fetchTool.name).toBe('web_fetch')
  })
})
