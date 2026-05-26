export function formatCents(cents, opts = {}) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  const currency = opts.currency ?? 'USD'
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const fracStr = frac < 10 ? `0${frac}` : String(frac)
  const sign = negative ? '-' : ''
  return `${sign}${currency} ${whole}.${fracStr}`
}

export function addCents(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return 0
  return Math.round(a) + Math.round(b)
}

export function percentOf(cents, percent) {
  if (typeof cents !== 'number' || typeof percent !== 'number') return 0
  return Math.round((cents * percent) / 100)
}
