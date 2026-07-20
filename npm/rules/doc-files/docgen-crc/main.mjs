/** @see ./docs/docgen-crc.md */
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { crc32 as zlibCrc32 } from 'node:zlib'
import { env } from 'node:process'
import { pluginDocFilesExtensions } from '../docgen-scan/lang-extensions.mjs'

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
const RESOURCE_RE = /^resource:[ \t]+(\S.*)$/mu
const CRC_RE = /^[ \t]{0,8}crc:[ \t]{0,8}(.+)$/mu
const MODEL_RE = /^[ \t]{0,8}model:[ \t]{0,8}(.+)$/mu
const TIER_RE = /^[ \t]{0,8}tier:[ \t]{0,8}(.+)$/mu
const SCORE_RE = /^[ \t]{0,8}score:[ \t]{0,8}(\d+)$/mu
const ISSUES_RE = /^[ \t]{0,8}issues:[ \t]{0,8}(.+)$/mu
const JUDGE_MODEL_RE = /^[ \t]{0,8}judgeModel:[ \t]{0,8}(.+)$/mu
const LEADING_NEWLINES_RE = /^\n+/u
const ISSUE_CODE_TAIL_RE = /[,:]$/u

/**
 * Парсить frontmatter файлової доки. Без блоку — `data:null` і `body` дорівнює входу.
 * Поля `model`/`score`/`issues` опційні (back-compat зі старими доками): без них —
 * `model:null`, `score:null`, `issues:[]`.
 * @param {string} md вміст md-файлу
 * @returns {{ data: { source: string|null, crc: string|null, model: string|null, tier: string|null, score: number|null, issues: string[], judgeModel: string|null }|null, body: string }} метадані + тіло без frontmatter
 */
export function parseDocFrontmatter(md) {
  const match = md.match(FRONTMATTER_RE)
  if (!match) return { data: null, body: md }
  const block = match[1]
  const scoreRaw = block.match(SCORE_RE)?.[1]
  const issuesRaw = block.match(ISSUES_RE)?.[1]
  const source = block.match(RESOURCE_RE)?.[1].trim() ?? null
  return {
    data: {
      source,
      crc: block.match(CRC_RE)?.[1].trim() ?? null,
      model: block.match(MODEL_RE)?.[1].trim() ?? null,
      tier: block.match(TIER_RE)?.[1].trim() ?? null,
      score: scoreRaw === undefined ? null : Number(scoreRaw),
      issues: issuesRaw
        ? issuesRaw
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
      judgeModel: block.match(JUDGE_MODEL_RE)?.[1].trim() ?? null
    },
    body: md.slice(match[0].length)
  }
}

/** Максимум кодів issues у frontmatter — це маркер, а не повний лог. */
const MAX_ISSUE_CODES = 8

/**
 * OKF `type` для файлу-джерела за розширенням — лише з декларацій активних
 * lang-плагінів (`contributes.docFiles.extensions`: js/mjs/ts/vue — lang-js,
 * `.rs`/`.py` — lang-rust/lang-python); вбудованих типів у ядрі немає
 * (фаза 5b spec lang-plugins-extraction). Невідоме розширення → 'Source File'.
 * @param {string} sourcePath відносний шлях джерела
 * @returns {string} тип концепту
 */
function typeForSource(sourcePath) {
  const ext = extname(sourcePath).toLowerCase()
  return pluginDocFilesExtensions(process.cwd())[ext] ?? 'Source File'
}

/**
 * Нормалізує issues до YAML-безпечних кодів: бере фрагмент до першого пробілу
 * (зрізає людиночитні хвости помилок), відкидає порожні, обмежує кількість.
 * @param {string[]} issues сирі issue-рядки від скорера
 * @returns {string[]} коди без пробілів
 */
function issueCodes(issues) {
  return issues
    .map(i => String(i).split(' ', 1)[0].replace(ISSUE_CODE_TAIL_RE, ''))
    .filter(Boolean)
    .slice(0, MAX_ISSUE_CODES)
}

/**
 * Будує OKF-сумісний frontmatter-блок: OKF-поля верхнього рівня + вкладений `docgen:`
 * з CRC/model/quality. OKF-поля виводяться першими, щоб будь-який OKF-парсер міг їх
 * читати незалежно від `docgen:`-простору назв.
 * @param {string} source відносний шлях джерела
 * @param {string} crc CRC32 джерела у hex
 * @param {{ score: number, issues?: string[], judge?: {model?: string} }|null} [quality] det-оцінка доки; null — без полів якості
 * @param {string|null} [model] повний id моделі-генератора; null — без поля `model`
 * @param {string|null} [tier] tier моделі-генератора (`local-min`, `cloud-avg` тощо); null — без поля `tier`
 * @returns {string} OKF-сумісний YAML frontmatter
 */
export function buildDocFrontmatter(source, crc, quality = null, model = null, tier = null) {
  const okfLines = [`type: ${typeForSource(source)}`, `title: ${basename(source)}`, `resource: ${source}`]

  // docgen namespace: лише CRC-механіка і quality (source перенесено у resource)
  const docgenLines = [`crc: ${crc}`]
  if (model) docgenLines.push(`model: ${model}`)
  if (tier) docgenLines.push(`tier: ${tier}`)
  if (quality && typeof quality.score === 'number') {
    docgenLines.push(`score: ${quality.score}`)
    const codes = issueCodes(quality.issues ?? [])
    if (codes.length > 0) docgenLines.push(`issues: ${codes.join(',')}`)
    if (quality.judge && quality.judge.model) docgenLines.push(`judgeModel: ${quality.judge.model}`)
  }
  const indented = docgenLines.map(l => '  ' + l).join('\n')
  return `---\n${okfLines.join('\n')}\ndocgen:\n${indented}\n---\n`
}

const LEADING_H1_RE = /^# [^\n]*\n+/u

/**
 * (Пере)штампує frontmatter у md-доку: знімає наявний блок і додає свіжий.
 * @param {string} md тіло доки (з frontmatter або без)
 * @param {string} source відносний шлях джерела
 * @param {string} crc CRC32 джерела у hex
 * @param {{ score: number, issues?: string[], judge?: {model?: string} }|null} [quality] det-оцінка доки (+ опц. `judge.model` хмарного судді)
 * @param {string|null} [model] повний id моделі-генератора; null — без поля `model`
 * @param {string|null} [tier] тир моделі-генератора; null — без поля `tier`
 * @returns {string} md зі свіжим frontmatter
 */
export function stampDoc(md, source, crc, quality = null, model = null, tier = null) {
  const { body } = parseDocFrontmatter(md)
  const cleanBody = body.replace(LEADING_NEWLINES_RE, '').replace(LEADING_H1_RE, '')
  return `${buildDocFrontmatter(source, crc, quality, model, tier)}\n${cleanBody}`
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
 * @returns {{ score: number|null, issues: string[], judgeModel: string|null }} `score:null` — доки немає або поле відсутнє; `judgeModel` — хмарна модель-суддя, що позначила док (або null)
 */
export function readDocQuality(docAbsPath) {
  if (!existsSync(docAbsPath)) return { score: null, issues: [], judgeModel: null }
  const data = parseDocFrontmatter(readFileSync(docAbsPath, 'utf8')).data
  return {
    score: data?.score ?? null,
    issues: data?.issues ?? [],
    judgeModel: data?.judgeModel ?? null
  }
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
 * Tier моделі-генератора зі frontmatter доки; `null` — доки немає або поле відсутнє.
 * @param {string} docAbsPath абсолютний шлях md-доки
 * @returns {string|null} tier моделі з frontmatter або null
 */
export function readDocTier(docAbsPath) {
  if (!existsSync(docAbsPath)) return null
  return parseDocFrontmatter(readFileSync(docAbsPath, 'utf8')).data?.tier ?? null
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
