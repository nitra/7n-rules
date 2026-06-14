/**
 * CRC32 джерела + YAML-frontmatter файлової документації.
 *
 * Кожна файлова дока несе у frontmatter контрольну суму байтів джерела на момент
 * генерації. Це детермінований маркер застарілості: `crc32(поточне джерело)` звіряється
 * з `crc` у доці — розбіжність (або відсутня дока) означає, що дока відстала від коду.
 * CRC не залежить від git-стану (rebase, незакомічене, гілки), тож придатний і для
 * per-edit hook (бачить лише змінений файл), і для повного сканування.
 *
 * Degraded-маркер (ADR 260610-2228): якщо локальний конвеєр не дотягнув до порогу
 * якості, дока все одно пишеться, а frontmatter додатково несе `score` (det-оцінка)
 * та `issues` (коди проблем). CRC при цьому свіжий — Stop-гейт не блокує задачі через
 * слабкість моделі; борг видимий через `check --degraded` і адресно перегенеровується
 * через `gen --retry-degraded`.
 *
 * Frontmatter — єдиний дозволений виняток із правила «чистий Markdown без HTML»:
 * це машинні метадані, не контент. Формат:
 *
 *   ---
 *   docgen:
 *     source: src/lib/foo.js
 *     crc: a3f1c9e0
 *     model: omlx/gemma-4-e4b-it-OptiQ-4bit
 *     score: 55
 *     issues: short-behavior,internal-name:bar
 *   ---
 *
 * `model` — повний id моделі-генератора (як повертає resolveModel, із префіксом
 * провайдера). Пасивна метадата: маркер «віку» доки за моделлю на додачу до CRC
 * джерела. На staleness НЕ впливає — звіряється лише `crc`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { crc32 as zlibCrc32 } from 'node:zlib'
import { env } from 'node:process'

/** Поріг degraded: дока зі `score` нижче вважається неякісною. */
export const QUALITY_THRESHOLD = Number(env.N_CURSOR_DOC_FILES_THRESHOLD ?? 70) || 70

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
const SOURCE_RE = /^[ \t]{0,8}source:[ \t]{0,8}(.+)$/mu
const CRC_RE = /^[ \t]{0,8}crc:[ \t]{0,8}(.+)$/mu
const MODEL_RE = /^[ \t]{0,8}model:[ \t]{0,8}(.+)$/mu
const SCORE_RE = /^[ \t]{0,8}score:[ \t]{0,8}(\d+)$/mu
const ISSUES_RE = /^[ \t]{0,8}issues:[ \t]{0,8}(.+)$/mu
const LEADING_NEWLINES_RE = /^\n+/u
const ISSUE_CODE_TAIL_RE = /[,:]$/u

/**
 * Парсить frontmatter файлової доки. Без блоку — `data:null` і `body` дорівнює входу.
 * Поля `model`/`score`/`issues` опційні (back-compat зі старими доками): без них —
 * `model:null`, `score:null`, `issues:[]`.
 * @param {string} md вміст md-файлу
 * @returns {{ data: { source: string|null, crc: string|null, model: string|null, score: number|null, issues: string[] }|null, body: string }} метадані + тіло без frontmatter
 */
export function parseDocFrontmatter(md) {
  const match = md.match(FRONTMATTER_RE)
  if (!match) return { data: null, body: md }
  const block = match[1]
  const scoreRaw = block.match(SCORE_RE)?.[1]
  const issuesRaw = block.match(ISSUES_RE)?.[1]
  return {
    data: {
      source: block.match(SOURCE_RE)?.[1].trim() ?? null,
      crc: block.match(CRC_RE)?.[1].trim() ?? null,
      model: block.match(MODEL_RE)?.[1].trim() ?? null,
      score: scoreRaw === undefined ? null : Number(scoreRaw),
      issues: issuesRaw
        ? issuesRaw
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : []
    },
    body: md.slice(match[0].length)
  }
}

/** Максимум кодів issues у frontmatter — це маркер, а не повний лог. */
const MAX_ISSUE_CODES = 8

/**
 * Нормалізує issues до YAML-безпечних кодів: бере фрагмент до першого пробілу
 * (зрізає людиночитні хвости помилок), відкидає порожні, обмежує кількість.
 * @param {string[]} issues сирі issue-рядки від скорера
 * @returns {string[]} коди без пробілів
 */
function issueCodes(issues) {
  return issues
    .map(i => String(i).split(' ')[0].replace(ISSUE_CODE_TAIL_RE, ''))
    .filter(Boolean)
    .slice(0, MAX_ISSUE_CODES)
}

/**
 * Будує frontmatter-блок із шляхом джерела, CRC, (опційно) моделлю-генератором і якістю.
 * @param {string} source відносний шлях джерела
 * @param {string} crc CRC32 джерела у hex
 * @param {{ score: number, issues?: string[] }|null} [quality] det-оцінка доки; null — без полів якості
 * @param {string|null} [model] повний id моделі-генератора; null — без поля `model`
 * @returns {string} рядок `---\ndocgen:\n  source: …\n  crc: …[\n  model: …][\n  score: …][\n  issues: …]\n---\n`
 */
export function buildDocFrontmatter(source, crc, quality = null, model = null) {
  const lines = [`source: ${source}`, `crc: ${crc}`]
  if (model) lines.push(`model: ${model}`)
  if (quality && typeof quality.score === 'number') {
    lines.push(`score: ${quality.score}`)
    const codes = issueCodes(quality.issues ?? [])
    if (codes.length > 0) lines.push(`issues: ${codes.join(',')}`)
  }
  const indented = lines.map(l => '  ' + l).join('\n')
  return `---\ndocgen:\n${indented}\n---\n`
}

/**
 * (Пере)штампує frontmatter у md-доку: знімає наявний блок і додає свіжий.
 * @param {string} md тіло доки (з frontmatter або без)
 * @param {string} source відносний шлях джерела
 * @param {string} crc CRC32 джерела у hex
 * @param {{ score: number, issues?: string[] }|null} [quality] det-оцінка доки
 * @param {string|null} [model] повний id моделі-генератора; null — без поля `model`
 * @returns {string} md зі свіжим frontmatter
 */
export function stampDoc(md, source, crc, quality = null, model = null) {
  const { body } = parseDocFrontmatter(md)
  return `${buildDocFrontmatter(source, crc, quality, model)}\n${body.replace(LEADING_NEWLINES_RE, '')}`
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
 * Якість, збережена у frontmatter доки.
 * @param {string} docAbsPath абсолютний шлях md-доки
 * @returns {{ score: number|null, issues: string[] }} `score:null` — доки немає або поле відсутнє
 */
export function readDocQuality(docAbsPath) {
  if (!existsSync(docAbsPath)) return { score: null, issues: [] }
  const data = parseDocFrontmatter(readFileSync(docAbsPath, 'utf8')).data
  return { score: data?.score ?? null, issues: data?.issues ?? [] }
}

/**
 * Модель-генератор, збережена у frontmatter доки; `null` — доки немає або поле відсутнє
 * (старі доки до введення `model`).
 * @param {string} docAbsPath абсолютний шлях md-доки
 * @returns {string|null} повний id моделі або null
 */
export function readDocModel(docAbsPath) {
  if (!existsSync(docAbsPath)) return null
  return parseDocFrontmatter(readFileSync(docAbsPath, 'utf8')).data?.model ?? null
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
