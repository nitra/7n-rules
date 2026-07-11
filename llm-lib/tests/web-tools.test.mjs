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

describe('assertPublicHttpUrl (SSRF-guard)', () => {
  test('публічні http/https проходять', () => {
    expect(assertPublicHttpUrl('https://example.com/docs').hostname).toBe('example.com')
    expect(assertPublicHttpUrl('http://8.8.8.8/x').hostname).toBe('8.8.8.8')
  })

  test.each([
    ['file:///etc/passwd', 'схема'],
    ['ftp://example.com/x', 'схема'],
    ['http://localhost:8000/v1', 'хост'],
    ['https://printer.local/admin', 'хост'],
    ['http://db.internal/secrets', 'хост'],
    ['http://127.0.0.1/x', 'IPv4'],
    ['http://10.1.2.3/x', 'IPv4'],
    ['http://172.20.0.1/x', 'IPv4'],
    ['http://192.168.1.1/x', 'IPv4'],
    ['http://169.254.169.254/latest/meta-data', 'IPv4'],
    ['http://[::1]/x', 'IPv6'],
    ['http://[fe80::1]/x', 'IPv6'],
    ['http://[fd00::1]/x', 'IPv6'],
    ['not a url', 'невалідний']
  ])('блокує %s', (url, reason) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(new RegExp(reason))
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
    expect(text).toMatch(/a\s*\n\s*b/)
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
      Promise.resolve(fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/meta' } }))
    )
    await expect(fetchPage('https://example.com/r', { fetchImpl })).rejects.toThrow(/IPv4/)
  })

  test('занадто багато redirect-ів → чесна відмова', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(fakeResponse({ status: 301, headers: { location: 'https://example.com/loop' } }))
    )
    await expect(fetchPage('https://example.com/loop', { fetchImpl })).rejects.toThrow(/redirect/)
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
