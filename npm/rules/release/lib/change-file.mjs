/**
 * Один change-файл `<ws>/.changes/<timestamp>-<rand>.md`: YAML-подібний frontmatter
 * із двома ключами (`bump`, `section`) + текст опису. Парсер мінімальний — лише ці два
 * ключі, без зовнішніх залежностей.
 */

/** Дозволені semver-бампи, від найбільшого до найменшого (порядок використовується для max). */
export const VALID_BUMPS = Object.freeze(['major', 'minor', 'patch'])

/** Дозволені Keep a Changelog секції (заголовок `### {section}`). */
export const VALID_SECTIONS = Object.freeze(['Added', 'Changed', 'Fixed', 'Removed'])

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/**
 * @param {string} block тіло frontmatter (між `---`)
 * @returns {Record<string, string>} пари ключ→значення
 */
function parseFrontmatterBlock(block) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

/**
 * @param {string} text вміст change-файлу
 * @returns {{ bump: string, section: string, description: string }} розпарсений запис
 */
export function parseChangeFile(text) {
  const m = FRONTMATTER_RE.exec(text)
  if (!m) throw new Error('change-файл: відсутній frontmatter `---`')
  const fm = parseFrontmatterBlock(m[1])
  const description = m[2].trim()
  if (!VALID_BUMPS.includes(fm.bump)) {
    throw new Error(`change-файл: bump має бути одним із ${VALID_BUMPS.join('|')} (отримано «${fm.bump ?? ''}»)`)
  }
  if (!VALID_SECTIONS.includes(fm.section)) {
    throw new Error(`change-файл: section має бути одним із ${VALID_SECTIONS.join('|')} (отримано «${fm.section ?? ''}»)`)
  }
  if (!description) throw new Error('change-файл: порожній опис')
  return { bump: fm.bump, section: fm.section, description }
}

/**
 * @param {{ bump: string, section: string, description: string }} entry запис
 * @returns {string} вміст change-файлу
 */
export function serializeChangeFile(entry) {
  return `---\nbump: ${entry.bump}\nsection: ${entry.section}\n---\n${entry.description}\n`
}
