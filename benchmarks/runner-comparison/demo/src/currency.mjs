/**
 * Format cents as a currency string.
 * @param {number} cents amount in cents
 * @param {{currency?: string}} opts formatting options
 * @returns {string} formatted currency amount
 */
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

/**
 * Add two cent amounts.
 * @param {number} a first amount
 * @param {number} b second amount
 * @returns {number} rounded sum in cents
 */
export function addCents(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return 0
  return Math.round(a) + Math.round(b)
}

/**
 * Calculate a percentage of cent amount.
 * @param {number} cents base amount in cents
 * @param {number} percent percentage value
 * @returns {number} calculated amount in cents
 */
export function percentOf(cents, percent) {
  if (typeof cents !== 'number' || typeof percent !== 'number') return 0
  return Math.round((cents * percent) / 100)
}
