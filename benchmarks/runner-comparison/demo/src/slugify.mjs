const NON_WORD = /[^\w\s-]/g
const SPACES = /\s+/g
const DASHES = /-+/g

export function slugify(input) {
  if (typeof input !== 'string') return ''
  let s = input.trim().toLowerCase()
  s = s.replace(NON_WORD, '')
  s = s.replace(SPACES, '-')
  s = s.replace(DASHES, '-')
  return s.length > 64 ? s.slice(0, 64) : s
}
