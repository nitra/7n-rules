/**
 * Перетворює довільний рядок у url-safe slug: нижній регістр, пробіли й
 * підкреслення → дефіс, недозволені символи вирізаються, дублі дефісів
 * схлопуються, краєві дефіси обрізаються.
 * @param {string} input вхідний рядок
 * @returns {string} slug або порожній рядок, якщо після очищення нічого не лишилось
 */
export function slugify(input) {
  if (typeof input !== 'string') return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Гарантує унікальність slug у межах набору вже зайнятих значень: якщо slug
 * зайнятий, дописує `-2`, `-3` тощо, поки не знайде вільний варіант.
 * @param {string} input вхідний рядок для slugify
 * @param {Set<string>} taken вже зайняті slug-и (мутується не буде)
 * @returns {string} унікальний slug
 */
export function uniqueSlugify(input, taken) {
  const base = slugify(input) || 'item'
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}
