/**
 * CRC32 джерела + YAML-frontmatter файлової документації.
 *
 * Кожна файлова дока несе у frontmatter контрольну суму байтів джерела на момент
 * генерації. Це детермінований маркер застарілості: `crc32(поточне джерело)` звіряється
 * з `crc` у доці — розбіжність (або відсутня дока) означає, що дока відстала від коду.
 * CRC не залежить від git-стану (rebase, незакомічене, гілки), тож придатний і для
 * per-edit hook (бачить лише змінений файл), і для повного сканування.
 *
 * Frontmatter — єдиний дозволений виняток із правила «чистий Markdown без HTML»:
 * це машинні метадані, не контент. Формат:
 *
 *   ---
 *   docgen:
 *     source: src/lib/foo.js
 *     crc: a3f1c9e0
 *   ---
 */
import { existsSync, readFileSync } from 'node:fs'
import { crc32 as zlibCrc32 } from 'node:zlib'

/**
 * CRC32 вмісту у hex (8 символів, з провідними нулями). Делегує у нативний
 * `node:zlib.crc32` — без ручної бітової арифметики.
 * @param {string|Buffer} input текст або байти джерела
 * @returns {string} CRC32 у hex
 */
export function crc32(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return zlibCrc32(buf).toString(16).padStart(8, '0')
}

/** Провідний YAML-frontmatter-блок `---\n…\n---`. */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/u
const SOURCE_RE = /^[ \t]*source:[ \t]*(.+)$/mu
const CRC_RE = /^[ \t]*crc:[ \t]*(.+)$/mu
const LEADING_NEWLINES_RE = /^\n+/u

/**
 * Парсить frontmatter файлової доки. Без блоку — `data:null` і `body` дорівнює входу.
 * @param {string} md вміст md-файлу
 * @returns {{ data: { source: string|null, crc: string|null }|null, body: string }} метадані + тіло без frontmatter
 */
export function parseDocFrontmatter(md) {
  const match = md.match(FRONTMATTER_RE)
  if (!match) return { data: null, body: md }
  const block = match[1]
  return {
    data: {
      source: block.match(SOURCE_RE)?.[1].trim() ?? null,
      crc: block.match(CRC_RE)?.[1].trim() ?? null
    },
    body: md.slice(match[0].length)
  }
}

/**
 * Будує frontmatter-блок із шляхом джерела та CRC.
 * @param {string} source відносний шлях джерела
 * @param {string} crc CRC32 джерела у hex
 * @returns {string} рядок `---\ndocgen:\n  source: …\n  crc: …\n---\n`
 */
export function buildDocFrontmatter(source, crc) {
  return `---\ndocgen:\n  source: ${source}\n  crc: ${crc}\n---\n`
}

/**
 * (Пере)штампує frontmatter у md-доку: знімає наявний блок і додає свіжий.
 * @param {string} md тіло доки (з frontmatter або без)
 * @param {string} source відносний шлях джерела
 * @param {string} crc CRC32 джерела у hex
 * @returns {string} md зі свіжим frontmatter
 */
export function stampDoc(md, source, crc) {
  const { body } = parseDocFrontmatter(md)
  return `${buildDocFrontmatter(source, crc)}\n${body.replace(LEADING_NEWLINES_RE, '')}`
}

/**
 * CRC, збережений у frontmatter доки; `null` — доки немає або CRC відсутній.
 * @param {string} docAbsPath абсолютний шлях md-доки
 * @returns {string|null} CRC32 з frontmatter або null
 */
export function readDocCrc(docAbsPath) {
  if (!existsSync(docAbsPath)) return null
  return parseDocFrontmatter(readFileSync(docAbsPath, 'utf8')).data?.crc ?? null
}

/**
 * Стан застарілості доки відносно її джерела.
 * `missing` — доки немає; `crc-mismatch` — CRC джерела ≠ CRC у доці; інакше свіжа.
 * @param {string} sourceAbsPath абсолютний шлях джерела
 * @param {string} docAbsPath абсолютний шлях md-доки
 * @returns {{ stale: boolean, reason: 'missing'|'crc-mismatch'|null }} стан застарілості
 */
export function staleness(sourceAbsPath, docAbsPath) {
  const docCrc = readDocCrc(docAbsPath)
  if (docCrc === null) return { stale: true, reason: 'missing' }
  const srcCrc = crc32(readFileSync(sourceAbsPath))
  if (srcCrc !== docCrc) return { stale: true, reason: 'crc-mismatch' }
  return { stale: false, reason: null }
}
