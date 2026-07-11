/** @see ./docs/web-tools.md */

/**
 * Web-доступ для cloud-профілів run-harness (Фаза A3, дизайн 2026-07-11).
 *
 * Мінімальне ядро без нових залежностей (референс — pi-web-access, без його
 * fallback-ланцюгів провайдерів, browser-cookie режимів і video-екстракції):
 *   - `web_fetch` — global fetch → текстова екстракція (html→text власним
 *     мінімальним стрипером, json/plain — як є) з лімітом розміру.
 *   - `web_search` — ОДИН провайдер за конфігом: `N_LLM_SEARCH_PROVIDER` або
 *     перший наявний ключ (`BRAVE_API_KEY` → `TAVILY_API_KEY` → `EXA_API_KEY`).
 *
 * Безпека (нова поверхня довіри — URL формує модель):
 *   - SSRF-guard: лише http/https; блок localhost/*.local та літеральних IP
 *     приватних діапазонів; redirect-и проходяться вручну (до 3 hop-ів) із
 *     guard-перевіркою КОЖНОГО hop-а.
 *   - Вміст сторінок повертається як tool-result (дані, не інструкції) —
 *     prompt-injection зі сторінок не отримує системного рівня.
 *   - Ліміт відповіді (`maxChars`) — проти роздування контексту.
 *
 * Модуль pi-free: `defineTool` і fetch інжектяться; ввімкнення — профілем
 * consumer-а (agent-fix `opts.webTools`, лише cloud-тири за дизайном).
 */

import { env as processEnv } from 'node:process'

/** Дефолтний таймаут одного web-запиту. */
const FETCH_TIMEOUT_MS = 20_000
/** Дефолтний ліміт символів відповіді tool-а (проти роздування контексту). */
const DEFAULT_MAX_CHARS = 20_000
/** Максимум redirect-hop-ів при ручному проході. */
const MAX_REDIRECTS = 3
/** Кількість результатів пошуку за замовчуванням. */
const DEFAULT_SEARCH_COUNT = 5

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/
const PRIVATE_V6 = /^(?:::1|::|fe80:|f[cd][0-9a-f]{2}:)/i
const HTML_CONTENT_TYPE = /text\/html|application\/xhtml/i
const BLOCK_CLOSE_TAGS = /<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi
const BR_HR_TAGS = /<(?:br|hr)\s*\/?>/gi
const SPACES = /[ \t]+/g
const BLANK_LINES = /\n{3,}/g

/**
 * SSRF-guard: чи можна ходити на URL. Кидає Error з причиною при відмові.
 * Блокує не-http(s), localhost/*.local/*.internal і літеральні приватні IP
 * (v4-діапазони, v6 loopback/link-local/ULA). DNS-резолюція не робиться —
 * захист від літералів; довірений периметр consumer-а лишається його політикою.
 * @param {string} rawUrl URL з tool-input
 * @returns {URL} розібраний URL (для подальшого fetch)
 */
export function assertPublicHttpUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`невалідний URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`заборонена схема ${url.protocol} (лише http/https)`)
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`заборонений хост: ${host}`)
  }
  const bare = host.replaceAll(/^\[|\]$/g, '')
  if (PRIVATE_V4.test(bare)) throw new Error(`приватна IPv4-адреса заборонена: ${host}`)
  if (PRIVATE_V6.test(bare)) throw new Error(`приватна IPv6-адреса заборонена: ${host}`)
  return url
}

/**
 * Ітеративно (без regex-backtracking) вирізає блоки `<tag …>…</tag>`.
 * @param {string} html вихідний html
 * @param {string} tag імʼя тега (lowercase)
 * @returns {string} html без блоків тега
 */
function stripTagBlocks(html, tag) {
  const open = `<${tag}`
  const close = `</${tag}>`
  const lower = () => html.toLowerCase()
  for (;;) {
    const start = lower().indexOf(open)
    if (start === -1) return html
    const end = lower().indexOf(close, start)
    if (end === -1) return html.slice(0, start)
    html = `${html.slice(0, start)} ${html.slice(end + close.length)}`
  }
}

/**
 * Char-scan стрип решти тегів (`<…>` → пробіл) без regex.
 * @param {string} text html після блокових замін
 * @returns {string} текст без тегів
 */
function stripTags(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, lt)
    const gt = text.indexOf('>', lt + 1)
    if (gt === -1) break
    out += ' '
    i = gt + 1
  }
  return out
}

/**
 * Мінімальна html→text екстракція: викидає script/style/noscript, блокові теги
 * зводить до переносів, решту тегів стрипає, декодує базові entity, стискає
 * порожні рядки. Це свідомо НЕ readability (без DOM-залежностей) — достатньо,
 * щоб агент прочитав документацію/README/чейнджлог.
 * @param {string} html сирий html
 * @returns {string} текст
 */
export function htmlToText(html) {
  let text = html
  for (const tag of ['script', 'style', 'noscript']) text = stripTagBlocks(text, tag)
  text = text.replaceAll(BLOCK_CLOSE_TAGS, '\n').replaceAll(BR_HR_TAGS, '\n')
  return stripTags(text)
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll(SPACES, ' ')
    .replaceAll(BLANK_LINES, '\n\n')
    .trim()
}

/**
 * Fetch з SSRF-guard на кожному redirect-hop-і, таймаутом і лімітом розміру.
 * @param {string} rawUrl цільовий URL
 * @param {{ timeoutMs?: number, maxChars?: number, fetchImpl?: typeof fetch }} [opts] параметри
 * @returns {Promise<{ url: string, status: number, contentType: string, text: string, truncated: boolean }>} сторінка текстом
 */
export async function fetchPage(
  rawUrl,
  { timeoutMs = FETCH_TIMEOUT_MS, maxChars = DEFAULT_MAX_CHARS, fetchImpl = fetch } = {}
) {
  let url = assertPublicHttpUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal })
      if (response.status < 300 || response.status >= 400) break
      if (hop >= MAX_REDIRECTS) throw new Error(`занадто багато redirect-ів (> ${MAX_REDIRECTS})`)
      const location = response.headers.get('location')
      if (!location) throw new Error(`redirect ${response.status} без Location`)
      url = assertPublicHttpUrl(new URL(location, url).href)
    }
    const contentType = response.headers.get('content-type') ?? ''
    const raw = await response.text()
    const text = HTML_CONTENT_TYPE.test(contentType) ? htmlToText(raw) : raw
    return {
      url: url.href,
      status: response.status,
      contentType,
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Search-адаптери: нормалізують відповідь до [{title, url, snippet}]. */
const PROVIDERS = {
  brave: {
    keyVar: 'BRAVE_API_KEY',
    async search(query, count, key, fetchImpl) {
      const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
      const r = await fetchImpl(u, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } })
      if (!r.ok) throw new Error(`brave: HTTP ${r.status}`)
      const data = await r.json()
      return (data.web?.results ?? []).map(x => ({ title: x.title, url: x.url, snippet: x.description ?? '' }))
    }
  },
  tavily: {
    keyVar: 'TAVILY_API_KEY',
    async search(query, count, key, fetchImpl) {
      const r = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: count })
      })
      if (!r.ok) throw new Error(`tavily: HTTP ${r.status}`)
      const data = await r.json()
      return (data.results ?? []).map(x => ({ title: x.title, url: x.url, snippet: x.content ?? '' }))
    }
  },
  exa: {
    keyVar: 'EXA_API_KEY',
    async search(query, count, key, fetchImpl) {
      const r = await fetchImpl('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query, numResults: count, contents: { text: { maxCharacters: 500 } } })
      })
      if (!r.ok) throw new Error(`exa: HTTP ${r.status}`)
      const data = await r.json()
      return (data.results ?? []).map(x => ({ title: x.title ?? x.url, url: x.url, snippet: x.text ?? '' }))
    }
  }
}

/**
 * Обирає search-провайдера: явний `N_LLM_SEARCH_PROVIDER` або перший наявний ключ.
 * @param {Record<string, string|undefined>} env середовище
 * @returns {{ name: string, key: string }|null} провайдер+ключ або null (жодного)
 */
export function resolveSearchProvider(env = processEnv) {
  const wanted = env.N_LLM_SEARCH_PROVIDER
  if (wanted) {
    const p = PROVIDERS[wanted]
    const key = p ? env[p.keyVar] : undefined
    return p && key ? { name: wanted, key } : null
  }
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (env[p.keyVar]) return { name, key: env[p.keyVar] }
  }
  return null
}

/**
 * Структурована текстова відмова tool-виклику.
 * @param {object} payload обʼєкт з `error`
 * @returns {{ content: Array<{ type: string, text: string }>, details: object }} tool-результат
 */
function toolFail(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: {} }
}

/**
 * Успішний текстовий tool-результат.
 * @param {string} text текст відповіді
 * @returns {{ content: Array<{ type: string, text: string }>, details: object }} tool-результат
 */
function toolOk(text) {
  return { content: [{ type: 'text', text }], details: {} }
}

/**
 * Фабрика пари pi-tools `web_search`/`web_fetch`.
 * @param {{ defineTool: (def: object) => object,
 *   deps?: { env?: Record<string, string|undefined>, fetchImpl?: typeof fetch } }} args контекст:
 *   pi defineTool + інжекції env/fetch для тестів
 * @returns {{ searchTool: object, fetchTool: object }} tool-дефініції для customTools
 */
export function createWebTools({ defineTool, deps = {} }) {
  const env = deps.env ?? processEnv
  const fetchImpl = deps.fetchImpl ?? fetch

  const searchTool = defineTool({
    name: 'web_search',
    label: 'Web search',
    description: 'Search the web. Returns a JSON list of {title, url, snippet}. Use web_fetch to read a result page.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search query' },
        count: { type: 'number', description: `max results (default ${DEFAULT_SEARCH_COUNT})` }
      },
      required: ['query']
    },
    execute: async (_id, { query, count }) => {
      const provider = resolveSearchProvider(env)
      if (!provider) {
        return toolFail({
          error:
            'search-провайдер не сконфігуровано: потрібен BRAVE_API_KEY / TAVILY_API_KEY / EXA_API_KEY (опц. N_LLM_SEARCH_PROVIDER)'
        })
      }
      try {
        const results = await PROVIDERS[provider.name].search(
          query,
          count ?? DEFAULT_SEARCH_COUNT,
          provider.key,
          fetchImpl
        )
        return toolOk(JSON.stringify({ provider: provider.name, results }))
      } catch (error) {
        return toolFail({ error: `web_search: ${error.message}` })
      }
    }
  })

  const fetchTool = defineTool({
    name: 'web_fetch',
    label: 'Web fetch',
    description:
      'Fetch a public http(s) URL and return its text content (html is stripped to text). Truncated to a size limit.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'absolute http(s) URL' },
        maxChars: { type: 'number', description: `truncate limit (default ${DEFAULT_MAX_CHARS})` }
      },
      required: ['url']
    },
    execute: async (_id, { url, maxChars }) => {
      try {
        const page = await fetchPage(url, { maxChars: maxChars ?? DEFAULT_MAX_CHARS, fetchImpl })
        return toolOk(JSON.stringify(page))
      } catch (error) {
        return toolFail({ error: `web_fetch: ${error.message}` })
      }
    }
  })

  return { searchTool, fetchTool }
}
