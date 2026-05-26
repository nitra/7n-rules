const NON_WORD = /[^\w\s-]/g
const SPACES = /\s+/g
const DASHES = /-+/g

/**
 * Convert text into a URL-safe slug.
 * @param {string} input source text
 * @returns {string} slug limited to 64 characters
 */
export function slugify(input) {
  if (typeof input !== 'string') return ''
  let s = input.trim().toLowerCase()
  s = s.replaceAll(NON_WORD, '')
  s = s.replaceAll(SPACES, '-')
  s = s.replaceAll(DASHES, '-')
  return s.length > 64 ? s.slice(0, 64) : s
}
