/** @see ./docs/docgen-gen.md */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { env } from 'node:process'
import { resolveModel } from '../../../lib/models.mjs'
import { DEFAULT_OMLX_MODEL } from '../../../lib/omlx.mjs'
import { callLlm } from '../../../lib/llm.mjs'
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { extractFacts } from './docgen-extract.mjs'
import { extractAnchors } from './docgen-extract-anchors.mjs'
import { QUALITY_THRESHOLD } from './docgen-crc.mjs'
import {
  oneShotMessages,
  sectionMessages,
  criticMessages,
  refineMessages,
  guaranteesFromMarkers
} from './docgen-prompts.mjs'

const FENCE_OPEN_RE = /^```[a-z]*\n?/
const FENCE_CLOSE_RE = /\n?```\s*$/
const LEADING_HEADING_RE = /^#{1,6}[ \t]{1,8}[^\n]{0,400}\n{1,8}/
const SECTION_HEADING_RE = /^##\s+(.+)/
const SECTION_KEY_CLEAN_RE = /[^а-яіїєґa-z0-9]/gi
const CACHE_MENTION_RE = /кеш/i
const CACHE_NEGATION_RE = /(?:не|без)\s+(?:\S+\s+)?кеш|немає\s+кеш/i
const CRITIC_NONE_RE = /^\s*NONE\s*$/i

/**
 * Прибирає код-фенс-обгортку (потрійні бектіки) й випадковий провідний
 * `##`-заголовок із секції.
 * @param {string} text сирий вихід моделі
 * @returns {string} очищений текст секції
 */
function stripSection(text) {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(FENCE_OPEN_RE, '').replace(FENCE_CLOSE_RE, '').trim()
  }
  t = t.replace(LEADING_HEADING_RE, '') // зрізати випадковий заголовок
  return t.trim()
}

/**
 * Stage 2 (детермінований лінт, 0 токенів): зрізає сигнатури `name(args)` → `name`.
 * Два проходи — щоб зняти вкладені виклики на кшталт `check(cwd = process.cwd())`.
 * Не чіпає дужки без ідентифікатора перед ними (напр. `(abie.mdc)`, «(наприклад)»).
 * @param {string} text текст секції
 * @returns {string} текст без сигнатур у дужках
 */
function stripSignatures(text) {
  let t = text
  for (let i = 0; i < 2; i++) t = t.replaceAll(/([`\w$.]{1,80})\([^()]{0,300}\)/g, '$1')
  return t
}

/**
 * Розбиває md на секції за ## заголовками.
 * @param {string} md зібраний документ
 * @returns {Record<string, string>} нормалізований ключ секції → її тіло
 */
function parseSections(md) {
  const result = {}
  let cur = null
  for (const line of md.split('\n')) {
    const m = line.match(SECTION_HEADING_RE)
    if (m) {
      cur = m[1].toLowerCase().replaceAll(SECTION_KEY_CLEAN_RE, '')
      result[cur] = ''
    } else if (cur) result[cur] += line + '\n'
  }
  return result
}

/**
 * Чи містить текст бектік-обгорнуте імʼя символу (`sym`) — уникає substring false positives.
 * @param {string} text текст секції
 * @param {string} sym імʼя символу без бектіків
 * @returns {boolean} true — імʼя згадано
 */
function hasName(text, sym) {
  return text.includes('`' + sym + '`')
}

/**
 * Stage 2.5 — детермінований скоринг (0 токенів): перевіряє вихід проти фактів.
 * @param {string} md зібраний документ
 * @param {object} facts факт-лист про файл
 * @returns {{ score: number, issues: string[] }} оцінка 0–100 і коди проблем
 */
function scoreDoc(md, facts) {
  const s = parseSections(md)
  let score = 100
  const issues = []

  if (!s['огляд']) {
    score -= 25
    issues.push('no-overview')
  }

  const behavior = s['поведінка'] ?? ''
  if (behavior.length < 60) {
    score -= 20
    issues.push('short-behavior')
  }

  const guarantees = s['гарантіїповедінки'] ?? ''
  // Будь-яка згадка "кеш" у Гарантіях коли файл не кешує — галюцинація
  // Негація: "не кешує", "не має кешування", "без кешування", "немає кешу"
  const cacheHit = CACHE_MENTION_RE.test(guarantees) && !CACHE_NEGATION_RE.test(guarantees)
  if (!facts.markers?.caches && cacheHit) {
    score -= 20
    issues.push('cache-hallucination')
  }

  for (const sym of facts.internalSymbols ?? []) {
    const inDoc = hasName(guarantees, sym) || hasName(s['огляд'] ?? '', sym) || hasName(s['поведінка'] ?? '', sym)
    if (inDoc) {
      score -= 10
      issues.push(`internal-name:${sym}`)
    }
  }

  return { score: Math.max(0, score), issues }
}

/**
 * E2 — один цикл critique→refine на секцію.
 * Повертає або уточнену чорнетку, або оригінал якщо критик повідомив NONE.
 * @param {'overview'|'behavior'|'api'} sectionKey ключ секції
 * @param {string} draft чорнетка секції
 * @param {object} facts факт-лист
 * @param {object|null} anchors анкори файлу
 * @param {string} model model-id
 * @param {number} timeoutMs ліміт на один виклик
 * @returns {string} фінальний текст секції
 */
function critiqueRefineSection(sectionKey, draft, facts, anchors, model, timeoutMs) {
  const critique = callLlm(criticMessages(sectionKey, draft, facts, anchors), model, { timeoutMs }).trim()
  if (!critique || CRITIC_NONE_RE.test(critique) || critique.length < 12) return draft
  const refined = callLlm(refineMessages(sectionKey, draft, critique, facts, anchors), model, { timeoutMs }).trim()
  return stripSignatures(stripSection(refined)) || draft
}

/**
 * Чи треба refine для секції API: тільки якщо є >1 експорту і всі desc-и порожні
 * (саме там модель схильна писати «застосовує логіку до файлу»).
 * @param {object} facts факт-лист
 * @returns {boolean} true — секцію API варто прогнати через критика
 */
function apiNeedsRefine(facts) {
  const exps = facts.exports ?? []
  if (exps.length <= 1) return false
  return exps.every(e => !e.desc)
}

/**
 * One-shot: один виклик LLM на весь документ (для unsupported-структур).
 * @param {object} facts факт-лист
 * @param {string} src вміст файлу
 * @param {string} model model-id
 * @param {number} [timeoutMs] ліміт на виклик
 * @returns {{ md: string }} зібраний документ
 */
function oneShotDoc(facts, src, model, timeoutMs = LOCAL_TIMEOUT_MS) {
  const text = callLlm(oneShotMessages(facts, src), model, { timeoutMs })
  let md = stripSignatures(stripSection(text))
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  return { md: md + '\n' }
}

/**
 * Stage 3: фіксовані заголовки у фіксованому порядку.
 * @param {string} stem назва файлу для H1
 * @param {Record<string, string>} sections тексти секцій за ключами
 * @returns {string} зібраний md-документ
 */
function assemble(stem, sections) {
  const order = [
    ['overview', '## Огляд'],
    ['behavior', '## Поведінка'],
    ['api', '## Публічний API'],
    ['guarantees', '## Гарантії поведінки']
  ]
  const parts = [`# ${stem}`]
  for (const [key, title] of order) {
    const body = sections[key]
    if (body && body.trim()) parts.push(`${title}\n\n${body.trim()}`)
  }
  return parts.join('\n\n') + '\n'
}

/**
 * Orchestrated: N окремих LLM-викликів, по одному на секцію.
 * Код потрапляє лише в `behavior`; решта секцій — на мінімальному факт-листі.
 * @param {object} facts факт-лист
 * @param {string} src вміст файлу
 * @param {string} model model-id
 * @param {number} timeoutMs ліміт на один виклик
 * @param {{ anchors?: object|null, temperature?: number }} [opts] анкори й температура семплінгу
 * @returns {{ md: string }} зібраний документ
 */
function orchestratedDoc(facts, src, model, timeoutMs, { anchors = null, temperature = 0.2 } = {}) {
  const sections = {}
  const anc = anchors ?? extractAnchors(src)
  // E3: «Гарантії» — детермінований шаблон з markers (0 LLM-запитів, 0 generic-фраз)
  sections.guarantees = guaranteesFromMarkers(facts)
  for (const s of sectionMessages(facts, src, anc)) {
    if (s.key === 'guarantees') continue // вже згенеровано детерміновано
    let draft = stripSignatures(stripSection(callLlm(s.messages, model, { timeoutMs, temperature })))
    // E2 + E3: critique→refine лише для секцій, де мала модель зриває на generic
    if (s.key === 'overview' || (s.key === 'api' && apiNeedsRefine(facts))) {
      draft = critiqueRefineSection(s.key, draft, facts, anc, model, timeoutMs)
    }
    sections[s.key] = draft
  }
  return { md: assemble(basename(facts.relPath), sections) }
}

/** Максимальний час генерації одного LLM-виклику. */
const LOCAL_TIMEOUT_MS = 5 * 60 * 1000
/**
 * Дефолтна модель: N_CURSOR_DOCGEN_MODEL → resolveModel('min') → omlx напряму.
 * Останній fallback гарантує local-only шлях без жодних env (через pi CLI той
 * самий локальний виклик виміряно повільніший на ~46%).
 */
export const DEFAULT_LOCAL_MODEL = env.N_CURSOR_DOCGEN_MODEL ?? (resolveModel('min') || `omlx/${DEFAULT_OMLX_MODEL}`)

/**
 * Головний API: файл → md-дока з det-оцінкою.
 *
 * Local-only (ADR 260610-2228): жодних cloud-ескалацій і pre-route — будь-який
 * файл генерується локальною моделлю. Якщо det-score нижче порогу, один retry
 * з вищою температурою (best-of-2); якщо й він не допоміг — результат
 * позначається `degraded`, рішення про перегенерацію приймає batch/користувач.
 * @param {string} file абсолютний шлях джерела
 * @param {{ model?: string, threshold?: number }} [opts] model-id і поріг degraded
 * @returns {{ md: string, ms: number, score: number|null, issues: string[], degraded: boolean, model: string }} документ і метадані генерації
 */
export function generateDoc(file, { model = DEFAULT_LOCAL_MODEL, threshold = QUALITY_THRESHOLD } = {}) {
  const src = readFileSync(file, 'utf8')
  const facts = extractFacts(src, file)
  const t0 = Date.now()

  const anchors = facts.unsupported ? null : extractAnchors(src)
  let r = facts.unsupported
    ? oneShotDoc(facts, src, model)
    : orchestratedDoc(facts, src, model, LOCAL_TIMEOUT_MS, { anchors })

  // unsupported (vue/py до юніт-шару): скорер не застосовний — score=null, не degraded
  if (facts.unsupported) {
    return { ...r, ms: Date.now() - t0, score: null, issues: [], degraded: false, model }
  }

  // Stage 2.5: детермінований скоринг (0 токенів)
  let { score, issues } = scoreDoc(r.md, facts)

  // E4: best-of-2 — один retry з вищою температурою, det-вибір кращого
  if (score < threshold && env.N_CURSOR_DOCGEN_BEST_OF !== '0') {
    try {
      const r2 = orchestratedDoc(facts, src, model, LOCAL_TIMEOUT_MS, { anchors, temperature: 0.5 })
      const s2 = scoreDoc(r2.md, facts)
      if (s2.score > score) {
        r = r2
        score = s2.score
        issues = [...s2.issues, 'best-of-2:retry-won']
      } else {
        issues = [...issues, 'best-of-2:retry-lost']
      }
    } catch (error) {
      issues = [...issues, `best-of-2:retry-error: ${error.message}`]
    }
  }

  return { ...r, ms: Date.now() - t0, score, issues, degraded: score < threshold, model }
}

// CLI: node docgen-gen.mjs <file> [--model <m>]
if (isRunAsCli(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  const mi = args.indexOf('--model')
  const model = mi === -1 ? DEFAULT_LOCAL_MODEL : args[mi + 1]
  if (!file) {
    throw new Error('Usage: node docgen-gen.mjs <file> [--model <m>]')
  }
  const r = generateDoc(file, { model })
  const issuesTxt = r.issues?.length ? ` issues=${r.issues.join(',')}` : ''
  process.stderr.write(`[local ${r.model}] ${r.ms}ms / score=${r.score}${r.degraded ? ' DEGRADED' : ''}${issuesTxt}\n`)
  process.stdout.write(r.md)
}
