export function parseQuery(qs) {
  if (typeof qs !== 'string' || qs.length === 0) return {}
  const out = {}
  const clean = qs.startsWith('?') ? qs.slice(1) : qs
  for (const pair of clean.split('&')) {
    if (pair.length === 0) continue
    const eq = pair.indexOf('=')
    if (eq === -1) {
      out[decodeURIComponent(pair)] = ''
    } else {
      const k = decodeURIComponent(pair.slice(0, eq))
      const v = decodeURIComponent(pair.slice(eq + 1))
      out[k] = v
    }
  }
  return out
}

export function buildQuery(params) {
  if (!params || typeof params !== 'object') return ''
  const parts = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.join('&')
}
