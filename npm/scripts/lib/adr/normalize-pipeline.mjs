/**
 * ADR normalize — локально-орієнтований конвеєр (інверсія керування: JS оркеструє,
 * LLM відповідає лише на вузькі verifiable-питання). Альтернатива single-shot-у
 * normalize-decisions.sh, заточена під малу локальну модель (omlx/gemma-4b).
 *
 * Принцип: модель НІКОЛИ не приймає глобальних рішень і не повертає великих
 * структур. Глобальний стан (кластери, слаги, покриття) тримає JS. Модель:
 *   - судить пару записів бінарно «те саме рішення? так/ні» (Stage 1),
 *   - для ізольованого драфта каже standalone/trivial (Stage 1b),
 *   - реформатить один драфт у чистий MADR (Stage 2),
 *   - пише short merge-additions (Stage 3).
 *
 * Стадії:
 *   0. retrieval (JS)   — лексична схожість → кандидати-ребра draft↔draft / draft↔clean
 *   1. edge-judge (LLM) — бінарне same/different по кожному ребру (self-consistency)
 *   1b. kind-judge(LLM) — standalone vs trivial для драфтів без ребер
 *   ── cluster (JS)     — union-find по підтверджених ребрах, вибір anchor, призначення op
 *   2. gen-MADR (LLM)   — reformat anchor/standalone → чистий MADR + validation gate
 *   3. gen-merge (LLM)  — additions для merge-драфтів
 *   ── assemble (JS)    — operations[] у форматі, сумісному з apply-ops
 *
 * Повертає той самий operations[]-контракт, що й single-shot — apply-логіка спільна.
 */
import { z } from 'zod'
import { callLlm, classifyOmlxError } from '../../../lib/llm.mjs'
import { CLOUD_MIN, resolveModel } from '../../../lib/models.mjs'

// ─────────────────────────── Stage 0: retrieval (JS) ───────────────────────────

const STOP = new Set(['adr', 'та', 'для', 'через', 'на', 'в', 'у', 'з', 'із', 'до', 'і', 'й', 'the', 'a', 'of', 'md'])

// Module-scope regex (oxlint prefer-static-regex: без рекомпіляції на кожен виклик).
const RE_MD_EXT = /\.md$/
const RE_TS_PREFIX = /^\d{6,8}-\d{4,6}-/
const RE_FENCE_OPEN = /^\s*```[a-z]*\s*\n?/i
const RE_FENCE_CLOSE = /\n?```\s*$/i
const RE_SLUG_NONWORD = /[^a-zа-яіїєґ0-9]+/gi
const RE_LEAD_HYPHEN = /^-+/
const RE_TRAIL_HYPHEN = /-+$/
const RE_UPDATE_HEAD = /^##\s+Update/
const RE_DECISION_SECTION = /##\s*Decision Outcome\s*([\s\S]{0,500})/i
const RE_NO_DECISION = /(не\s+обрано|не\s+прийнят|рішення\s+не\s+прийн|не\s+зроблен|no\s+decision|undecided)/i
const RE_FENCE_LEAD = /^\s*```/
const RE_FENCE_TRAIL = /```\s*$/
const RE_FRONTMATTER = /^---\s*$/m
const RE_SESSION = /\bsession:\s/
const RE_H1 = /^#\s+\S/m
const RE_STATUS = /\*\*Status:\*\*/
const RE_DATE = /\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/
const RE_TOKEN_SPLIT = /[^a-zа-яіїєґ0-9]+/i
const RE_DRAFT_ADR_TITLE = /^#{1,2}\s+ADR\s+(.+)$/m

/**
 * Прибирає code-fence-обгортку з LLM-відповіді.
 * @param {string} raw сира відповідь LLM
 * @returns {string} текст без обгортки code-fence
 */
const stripFence = (raw) => raw.replace(RE_FENCE_OPEN, '').replace(RE_FENCE_CLOSE, '').trim()
/**
 * Назва clean-ADR → людський заголовок (без .md і timestamp-префікса).
 * @param {string} s basename clean-ADR
 * @returns {string} людський заголовок
 */
const stripAdrName = (s) => s.replace(RE_MD_EXT, '').replace(RE_TS_PREFIX, '')

/**
 * Токенізує назву/слаг у множину значущих токенів (kebab + пробіли, без стоп-слів).
 * @param {string} s назва або слаг для токенізації
 * @returns {Set<string>} множина значущих токенів
 */
export function tokenize(s) {
  return new Set(
    s
      .toLowerCase()
      .replace(RE_MD_EXT, '')
      .replace(RE_TS_PREFIX, '')
      .split(RE_TOKEN_SPLIT)
      .filter((t) => t.length > 2 && !STOP.has(t))
  )
}

/**
 * Jaccard-схожість двох множин токенів.
 * @param {Set<string>} a перша множина токенів
 * @param {Set<string>} b друга множина токенів
 * @returns {number} коефіцієнт Jaccard у діапазоні 0..1
 */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

const MADR_SECTION = /^(Context and Problem|Considered Options|Decision Outcome|Consequences|More Information|report|summary|Attempt|Reason|Update)\b/i

/**
 * Витягує заголовок драфта. Капчер пише `## ADR <title>` — він у пріоритеті
 * (чернетка може мати контент-заголовки раніше або взагалі не мати ADR-рядка).
 * Fallback-и: перший h1, що не є MADR-секцією, інакше '' (caller бере імʼя файлу).
 * @param {string} body тіло чернетки
 * @returns {string} заголовок або ''
 */
export function draftTitle(body) {
  const adr = body.match(RE_DRAFT_ADR_TITLE)
  if (adr) return adr[1].trim()
  for (const m of body.matchAll(/^#\s+(.+)$/gm)) {
    if (!MADR_SECTION.test(m[1].trim())) return m[1].trim()
  }
  return ''
}

/**
 * Детермінований no-decision гейт (харднінг #1). Чернетка, де у `Decision Outcome`
 * рішення явно НЕ прийняте (transcript обірвався) — не варта окремого ADR: gold
 * (sonnet) такі видаляє. Ловимо без LLM, щоб не покладатися на kind-judge малої моделі.
 * @param {string} body тіло чернетки
 * @returns {boolean} true якщо рішення не прийняте
 */
export function isNoDecision(body) {
  const m = body.match(RE_DECISION_SECTION)
  if (!m) return false
  // NB: JS \b не працює з кирилицею — покладаємось на пробіл/межі фрази без \b.
  return RE_NO_DECISION.test(m[1])
}

/**
 * Будує кандидати-ребра за лексичною схожістю.
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} cleanList clean basename-и
 * @param {{simThreshold?:number, topKClean?:number}} [opts] поріг схожості та ліміт clean-кандидатів
 * @returns {{dd:[number,number][], dc:[number,string][]}} ребра draft↔draft (dd) і draft↔clean (dc)
 */
export function buildEdges(drafts, cleanList, opts = {}) {
  const simThreshold = opts.simThreshold ?? 0.12
  const topKClean = opts.topKClean ?? 3
  const draftTok = drafts.map((d) => tokenize(`${d.file} ${draftTitle(d.body)}`))
  const cleanTok = new Map(cleanList.map((c) => [c, tokenize(c)]))

  const dd = []
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      if (jaccard(draftTok[i], draftTok[j]) >= simThreshold) dd.push([i, j])
    }
  }
  const dc = []
  for (let i = 0; i < drafts.length; i++) {
    const scored = []
    for (const [c, tok] of cleanTok) {
      const s = jaccard(draftTok[i], tok)
      if (s >= simThreshold) scored.push([c, s])
    }
    scored.sort((a, b) => b[1] - a[1])
    for (const [c] of scored.slice(0, topKClean)) dc.push([i, c])
  }
  return { dd, dc }
}

// ─────────────────────────── LLM helper: tier cascade ──────────────────────────

const LOCAL = () => resolveModel('min')

/**
 * Виклик LLM з локальним ретраєм і (опційно) хмарною ескалацією.
 * @param {Array<{role:string,content:string}>} messages чат-повідомлення для LLM
 * @param {(raw:string)=>any} parse валідатор (кидає на невалідному)
 * @param {{label:string, allowCloud:boolean, attempts?:number, stats:object, maxTokens?:number}} cfg конфіг каскаду (мітка, дозвіл на хмару, спроби, лічильники, ліміт токенів)
 * @returns {any} результат parse
 * @throws {Error} якщо всі спроби провалені
 */
function callWithCascade(messages, parse, cfg) {
  const attempts = cfg.attempts ?? 2
  const temps = [0.1, 0.4, 0.7]
  let lastErr = null
  for (let a = 0; a < attempts; a++) {
    try {
      cfg.stats.localCalls++
      const raw = callLlm(messages, LOCAL(), {
        timeoutMs: 120_000,
        temperature: temps[a] ?? 0.2,
        maxTokens: cfg.maxTokens ?? 4096,
        caller: `adr-pipe:${cfg.label}`
      })
      return parse(raw)
    } catch (error) {
      lastErr = error
      if (classifyOmlxError(error.message) === 'infra') break
    }
  }
  if (cfg.allowCloud && CLOUD_MIN) {
    try {
      cfg.stats.cloudCalls++
      cfg.stats.escalations++
      const raw = callLlm(messages, CLOUD_MIN, { timeoutMs: 120_000, temperature: 0.2, maxTokens: cfg.maxTokens ?? 4096, caller: `adr-pipe:${cfg.label}:cloud` })
      return parse(raw)
    } catch (error) {
      lastErr = error
    }
  }
  cfg.stats.failures++
  throw lastErr ?? new Error('callWithCascade: no result')
}

/**
 * Витяг першого JSON-обʼєкта з raw-тексту.
 * @param {string} raw сирий текст відповіді LLM
 * @returns {any} розпарсений JSON-обʼєкт
 * @throws {Error} якщо у тексті немає JSON-обʼєкта
 */
function extractJson(raw) {
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s === -1 || e === -1) throw new Error('no JSON object')
  return JSON.parse(raw.slice(s, e + 1))
}

// ─────────────────────────── Stage 1: edge-judge (LLM) ─────────────────────────

const EdgeSchema = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(3).max(400)
})

const EDGE_SYS = `Ти порівнюєш два короткі записи архітектурних рішень (ADR). Визнач, чи вони описують ОДНЕ І ТЕ САМЕ рішення (одну тему/механізм, де другий лише уточнює/доповнює/продовжує перший), чи це РІЗНІ незалежні рішення.

Поверни ЛИШЕ JSON, без markdown:
{ "same": true|false, "confidence": 0..1, "reason": "<коротко українською>" }

same=true ЛИШЕ якщо це по суті одне рішення (дублікат, уточнення, продовження тієї самої теми). Різні аспекти однієї підсистеми, але окремі рішення → same=false. Якщо сумніваєшся — false.`

/**
 * Бінарний суддя «те саме рішення?» з self-consistency. Консервативний: `same`
 * лише якщо ВСІ голоси кажуть same з confidence ≥ minConf. Харднінг #2: для
 * draft↔draft (ризик over-merge) піднімаємо до 3 голосів і порога 0.6.
 * @param {string} aTitle заголовок запису A
 * @param {string} aBody тіло запису A
 * @param {string} bTitle заголовок запису B
 * @param {string} bBody тіло запису B
 * @param {{allowCloud:boolean, votes?:number, stats:object}} cfg конфіг каскаду (дозвіл на хмару, голоси, лічильники)
 * @param {{votes?:number, minConf?:number}} [vote] override голосів і порога на тип ребра
 * @returns {{same:boolean, votes:object[]}} підтвердження same та сирі голоси
 */
function judgeEdge(aTitle, aBody, bTitle, bBody, cfg, vote = {}) {
  const nVotes = vote.votes ?? cfg.votes ?? 2
  const minConf = vote.minConf ?? 0.5
  const user = `Запис A — "${aTitle}":\n${aBody.slice(0, 1500)}\n\n---\n\nЗапис B — "${bTitle}":\n${bBody.slice(0, 1500)}\n\nЦе одне й те саме рішення?`
  const parse = (raw) => EdgeSchema.parse(extractJson(raw))
  const votes = []
  for (let v = 0; v < nVotes; v++) {
    try {
      votes.push(callWithCascade([{ role: 'system', content: EDGE_SYS }, { role: 'user', content: user }], parse, { label: 'edge', allowCloud: cfg.allowCloud, stats: cfg.stats, maxTokens: 300 }))
    } catch {
      votes.push({ same: false, confidence: 0, reason: 'judge failed → conservative different' })
    }
  }
  const sameCount = votes.filter((v) => v.same && v.confidence >= minConf).length
  return { same: sameCount === votes.length, votes }
}

// ─────────────────────────── Stage 1b: kind-judge (LLM) ────────────────────────

const KindSchema = z.object({
  kind: z.enum(['standalone', 'trivial']),
  reason: z.string().min(3).max(400)
})

const KIND_SYS = `Ти оцінюєш чернетку архітектурного рішення (ADR). Визнач:
- "standalone" — це самостійне рішення, варте збереження як decision record.
- "trivial" — порожнє / тривіальне / косметичне / без реального рішення, можна видалити.

Поверни ЛИШЕ JSON: { "kind": "standalone"|"trivial", "reason": "<коротко українською>" }
Якщо сумніваєшся — "standalone" (краще зберегти).`

function judgeKind(title, body, cfg) {
  const user = `Чернетка — "${title}":\n${body.slice(0, 2500)}\n\nstandalone чи trivial?`
  const parse = (raw) => KindSchema.parse(extractJson(raw))
  try {
    return callWithCascade([{ role: 'system', content: KIND_SYS }, { role: 'user', content: user }], parse, { label: 'kind', allowCloud: cfg.allowCloud, stats: cfg.stats, maxTokens: 200 })
  } catch {
    return { kind: 'standalone', reason: 'judge failed → conservative standalone' }
  }
}

// ─────────────────────────── Stage 2: gen-MADR (LLM) ───────────────────────────

const MADR_HEADINGS = [
  '## Context and Problem Statement',
  '## Considered Options',
  '## Decision Outcome',
  '## More Information'
]

/**
 * Детермінований гейт якості згенерованого MADR.
 * @param {string} content згенерований MADR-текст
 * @returns {{ok:boolean, errors:string[]}} результат перевірки та перелік порушень
 */
export function validateMadr(content) {
  const errors = []
  if (!content || content.length < 80) errors.push('too short')
  if (RE_FENCE_LEAD.test(content) || RE_FENCE_TRAIL.test(content.trim())) errors.push('code-fence wrapper')
  if (RE_FRONTMATTER.test(content.split('\n').slice(0, 3).join('\n'))) errors.push('has YAML frontmatter')
  if (RE_SESSION.test(content)) errors.push('leaked session: field')
  if (!RE_H1.test(content)) errors.push('missing # title')
  if (!RE_STATUS.test(content)) errors.push('missing Status')
  if (!RE_DATE.test(content)) errors.push('missing/!ISO Date')
  for (const h of MADR_HEADINGS) if (!content.includes(h)) errors.push(`missing heading ${h}`)
  return { ok: errors.length === 0, errors }
}

const GEN_SYS = `Ти нормалізуєш чернетку ADR у чистий фінальний MADR 4.0.0. Чернетка вже містить секції — твоя задача ОЧИСТИТИ й привести до канону, НЕ вигадуючи нового.

Поверни ЛИШЕ markdown файлу (починається з "# "), без code-fence, без передмови, без YAML frontmatter.

Структура РІВНО така:
# <Заголовок українською>

**Status:** Accepted
**Date:** <YYYY-MM-DD з поля captured чернетки, перші 10 символів>

## Context and Problem Statement
<...>

## Considered Options
<bullets; якщо альтернатив не було — "Інші варіанти не обговорювалися.">

## Decision Outcome
Chosen option: "<...>", because <...>.

### Consequences
<bullets "Good, because ...", "Bad, because ...">

## More Information
<файли, команди, API; якщо нема — "Додаткової інформації не зафіксовано.">

Не вигадуй альтернатив, наслідків чи контексту, яких нема в чернетці. Прибери YAML frontmatter (session/captured/transcript) повністю.`

const slugify = (title) =>
  title.toLowerCase().replace(RE_SLUG_NONWORD, '-').replace(RE_LEAD_HYPHEN, '').slice(0, 60).replace(RE_TRAIL_HYPHEN, '') || 'adr'

function genMadr(title, body, captured, cfg) {
  const date = (captured ?? '').slice(0, 10)
  const user = `Чернетка "${title}" (captured: ${captured ?? 'невідомо'}):\n\n${body}\n\nПоверни чистий MADR. Date = ${date || 'візьми з captured'}.`
  const parse = (raw) => {
    const content = stripFence(raw)
    const v = validateMadr(content)
    if (!v.ok) throw new Error(`MADR invalid: ${v.errors.join('; ')}`)
    return content
  }
  try {
    const content = callWithCascade([{ role: 'system', content: GEN_SYS }, { role: 'user', content: user }], parse, { label: 'gen', allowCloud: cfg.allowCloud, stats: cfg.stats, attempts: 3, maxTokens: 4096 })
    return { content, slug: slugify(title), valid: true }
  } catch (error) {
    cfg.stats.madrInvalid++
    return { content: null, slug: slugify(title), valid: false, error: error.message }
  }
}

// ─────────────────────────── Stage 3: gen-merge (LLM) ──────────────────────────

const MERGE_SYS = `Ти готуєш короткий блок-доповнення до існуючого ADR. Поверни ЛИШЕ markdown-блок (без code-fence), що починається рядком "## Update <YYYY-MM-DD>", і містить ЛИШЕ новий зміст, якого ще нема в цільовому ADR (уточнення/виправлення/продовження). Стисло. Без передмови.`

function genMerge(title, body, captured, targetTitle, cfg) {
  const date = (captured ?? '').slice(0, 10)
  const user = `Цільовий ADR: "${targetTitle}".\nЧернетка-доповнення "${title}" (${date}):\n${body.slice(0, 2500)}\n\nДай блок "## Update ${date}" з НОВИМ змістом.`
  const parse = (raw) => {
    const t = stripFence(raw)
    if (!RE_UPDATE_HEAD.test(t)) throw new Error('missing ## Update heading')
    return t
  }
  try {
    return callWithCascade([{ role: 'system', content: MERGE_SYS }, { role: 'user', content: user }], parse, { label: 'merge', allowCloud: cfg.allowCloud, stats: cfg.stats, attempts: 2, maxTokens: 1500 })
  } catch {
    return `## Update ${date}\n\n(доповнення з чернетки "${title}")`
  }
}

// ─────────────────────────── union-find ────────────────────────────────────────

function makeDSU(n) {
  const p = Array.from({ length: n }, (_, i) => i)
  const find = (x) => (p[x] === x ? x : (p[x] = find(p[x])))
  const union = (a, b) => { p[find(a)] = find(b) }
  return { find, union }
}

const captureField = (body, field) => (body.match(new RegExp(`^${field}:\\s*(.+)$`, 'm')) ?? [])[1]?.trim()

/**
 * No-op за замовчуванням для onProgress (коли caller не передав логер).
 * @returns {void} нічого не робить
 */
const noop = () => {
  // навмисно порожньо: тихий fallback для onProgress
}

// ─────────────────────────── orchestrator ──────────────────────────────────────

/**
 * Головний конвеєр. Повертає operations[] (контракт single-shot) + stats.
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} cleanList clean basename-и
 * @param {{allowCloud?:boolean, votes?:number, onProgress?:(m:string)=>void}} [opts] хмарна ескалація, кількість голосів і колбек прогресу
 * @returns {{operations:object[], stats:object, trace:object}} операції apply-ops, лічильники та діагностичний trace
 */
export function normalizePipeline(drafts, cleanList, opts = {}) {
  const allowCloud = opts.allowCloud ?? false
  const log = opts.onProgress ?? noop
  const stats = { localCalls: 0, cloudCalls: 0, escalations: 0, failures: 0, madrInvalid: 0 }
  const cfg = { allowCloud, votes: opts.votes ?? 2, stats }

  const titles = drafts.map((d) => draftTitle(d.body) || d.file.replace(RE_MD_EXT, ''))
  const captured = drafts.map((d) => captureField(d.body, 'captured'))

  // Харднінг #1: детермінований no-decision гейт. Такі драфти не кластеризуємо й
  // не rewrite-имо — одразу delete (без LLM), як це робить gold.
  const noDec = drafts.map((d) => isNoDecision(d.body))
  if (noDec.some(Boolean)) log(`no-decision гейт: ${noDec.filter(Boolean).length} драфт(ів) → delete`)

  // Stage 0: retrieval (ребра, що торкаються no-decision драфтів, відкидаємо)
  const edges = buildEdges(drafts, cleanList)
  const dd = edges.dd.filter(([i, j]) => !noDec[i] && !noDec[j])
  const dc = edges.dc.filter(([i]) => !noDec[i])
  log(`retrieval: ${dd.length} draft-draft ребер, ${dc.length} draft-clean кандидатів`)

  // Stage 1: judge draft↔draft ребра (харднінг #2: 3 голоси, conf ≥ 0.6 проти over-merge)
  const dsu = makeDSU(drafts.length)
  const confirmedDD = []
  for (const [i, j] of dd) {
    const r = judgeEdge(titles[i], drafts[i].body, titles[j], drafts[j].body, cfg, { votes: 3, minConf: 0.6 })
    if (r.same) { dsu.union(i, j); confirmedDD.push([i, j]) }
  }
  log(`edge-judge: ${confirmedDD.length}/${dd.length} draft-draft ребер підтверджено`)

  // Stage 1: judge draft↔clean → найкращий existing-target на драфт
  const cleanTarget = Array.from({ length: drafts.length }).fill(null)
  const dcByDraft = new Map()
  for (const [i, c] of dc) { if (!dcByDraft.has(i)) dcByDraft.set(i, []); dcByDraft.get(i).push(c) }
  for (const [i, cands] of dcByDraft) {
    for (const c of cands) {
      const cTitle = stripAdrName(c)
      const r = judgeEdge(titles[i], drafts[i].body, cTitle, cTitle, cfg)
      if (r.same) { cleanTarget[i] = c; break }
    }
  }
  log(`clean-match: ${cleanTarget.filter(Boolean).length} драфтів вже покриті clean-ADR`)

  // Cluster (JS): групуємо за DSU
  const clusters = new Map()
  for (let i = 0; i < drafts.length; i++) {
    const root = dsu.find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(i)
  }

  const decision = Array.from({ length: drafts.length }).fill(null)
  const operations = []

  for (const [, members] of clusters) {
    if (members.length > 1) {
      // anchor — лише серед non-noDec (no-decision не може бути канонічним rewrite)
      const live = members.filter((m) => !noDec[m])
      // anchor = індекс із найдовшим drafts[idx].body.length; при рівності — перший
      // зустрінутий (еквівалент reduce з `>=`, що зберігає поточний акумулятор a).
      const candidates = live.length ? live : members
      let anchor = candidates[0]
      for (let k = 1; k < candidates.length; k++) {
        if (drafts[candidates[k]].body.length > drafts[anchor].body.length) anchor = candidates[k]
      }
      decision[anchor] = { op: 'rewrite' }
      for (const m of members) {
        if (m === anchor) continue
        decision[m] = noDec[m] ? { op: 'delete', reason: 'рішення не прийняте (transcript обірвався)' } : { op: 'merge-anchor', anchorIdx: anchor }
      }
    } else {
      const i = members[0]
      if (noDec[i]) decision[i] = { op: 'delete', reason: 'рішення не прийняте (transcript обірвався)' }
      else if (cleanTarget[i]) decision[i] = { op: 'merge-existing', target: cleanTarget[i] }
      else decision[i] = { op: 'kind' }
    }
  }

  // одинаки без clean-target → kind-judge
  for (let i = 0; i < drafts.length; i++) {
    if (decision[i].op === 'kind') {
      const k = judgeKind(titles[i], drafts[i].body, cfg)
      decision[i] = k.kind === 'trivial' ? { op: 'delete', reason: k.reason } : { op: 'rewrite' }
    }
  }

  // Stage 2: gen-MADR для всіх rewrite (anchors + standalones)
  const slugByIdx = Array.from({ length: drafts.length }).fill(null)
  for (let i = 0; i < drafts.length; i++) {
    if (decision[i].op !== 'rewrite') continue
    const g = genMadr(titles[i], drafts[i].body, captured[i], cfg)
    slugByIdx[i] = g.slug
    if (g.valid) {
      operations.push({ op: 'rewrite', file: drafts[i].file, slug: g.slug, content: g.content })
    } else {
      decision[i] = { op: 'gen-failed' }
      log(`gen-MADR FAILED для ${drafts[i].file}: ${g.error}`)
    }
  }

  // Stage 3: merges
  for (let i = 0; i < drafts.length; i++) {
    const d = decision[i]
    if (d.op === 'merge-anchor') {
      const slug = slugByIdx[d.anchorIdx]
      if (!slug) { log(`merge-anchor ${drafts[i].file}: anchor gen failed → skip`); continue }
      const add = genMerge(titles[i], drafts[i].body, captured[i], titles[d.anchorIdx], cfg)
      operations.push({ op: 'merge-into', file: drafts[i].file, target: `${slug}.md`, additions: add })
    } else if (d.op === 'merge-existing') {
      const cTitle = stripAdrName(d.target)
      const add = genMerge(titles[i], drafts[i].body, captured[i], cTitle, cfg)
      operations.push({ op: 'merge-into', file: drafts[i].file, target: d.target, additions: add })
    } else if (d.op === 'delete') {
      operations.push({ op: 'delete', file: drafts[i].file, reason: d.reason })
    }
  }

  const trace = {
    titles,
    clusters: Array.from(clusters.values(), (m) => m.map((i) => drafts[i].file)),
    cleanTargets: cleanTarget.map((c, i) => (c ? [drafts[i].file, c] : null)).filter(Boolean),
    decisions: decision.map((d, i) => [drafts[i].file, d.op])
  }
  return { operations, stats, trace }
}
