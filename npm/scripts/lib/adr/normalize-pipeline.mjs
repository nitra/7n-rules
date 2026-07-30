/**
 * ADR normalize — локально-орієнтований конвеєр (інверсія керування: JS оркеструє,
 * LLM відповідає лише на вузькі verifiable-питання). Альтернатива single-shot-у
 * normalize-decisions.sh, заточена під малу локальну модель (omlx/gemma-4b).
 *
 * Принцип: модель НІКОЛИ не приймає глобальних рішень, не повертає великих
 * структур і НЕ форматує. Глобальний стан (кластери, слаги, покриття) та весь
 * MADR-каркас (заголовок, Status/Date, назви секцій, fallback-фрази, шаблон
 * "Chosen option…") тримає JS. Модель повертає лише вузький, verifiable зміст:
 *   - судить пару записів бінарно «те саме рішення? так/ні» (Stage 1),
 *   - для ізольованого драфта каже standalone/trivial (Stage 1b),
 *   - витягує зміст секцій одного драфта як JSON (Stage 2) — каркас будує JS,
 *   - пише short merge-additions без заголовка (Stage 3) — «## Update <date>» додає JS.
 *
 * Стадії:
 *   0. retrieval (JS)   — лексична схожість → кандидати-ребра draft↔draft / draft↔clean
 *   1. edge-judge (LLM) — бінарне same/different по кожному ребру (self-consistency)
 *   1b. kind-judge(LLM) — standalone vs trivial для драфтів без ребер
 *   ── cluster (JS)     — union-find по підтверджених ребрах, вибір anchor, призначення op
 *   2. gen-MADR         — LLM витягує секції-JSON → assembleMadr() (JS) збирає канон → validation gate
 *   3. gen-merge        — LLM пише additions-прозу → JS додає «## Update <date>»-заголовок
 *   ── assemble (JS)    — operations[] у форматі, сумісному з apply-ops
 *
 * Повертає той самий operations[]-контракт, що й single-shot — apply-логіка спільна.
 *
 * Batch-хвилі (уніфікація на `@7n/llm-lib/batch`, спека
 * `docs/specs/2026-07-27-batch-local-avg-real-batches.md`, кластер E): кожна
 * LLM-стадія — ОДИН `submitBatch`-виклик на ВСІ незалежні items стадії
 * (усі ребра Stage 1, усі self-consistency голоси, усі драфти Stage 1b/2/3)
 * замість послідовного `for`-циклу з await на кожен виклик. Стадії лишаються
 * послідовними МІЖ собою (Stage 1b/2/3 читають рішення, обчислені з
 * результатів Stage 1) — паралелиться лише ВСЕРЕДИНІ стадії.
 *
 * Спрощення проти попереднього послідовного шляху (задокументовано, не
 * випадковість): `callWithCascade` робив до 2-3 локальних СПРОБ ОДНОГО tier1
 * перед хмарною ескалацією; тут — рівно один tier1-прохід на стадію, і лише
 * ті items, чия tier1-відповідь не розпарсилась, ідуть у хмарну хвилю (якщо
 * `allowCloud`). Це той самий tier1→tier2→conservative-fallback каскад, без
 * повтору tier1 перед ескалацією — на великому batch-і агрегована якість
 * tier1 вже статистично стабільна, а item, що впав, швидше відновлюється
 * хмарним tier2, ніж повторним локальним проходом.
 */
// Namespace-імпорт замість `import { z }`: Bun показує фантомний `__esModule` на ESM-неймспейсах,
// через що interop у vitest приймає default-експорт zod за CJS-обгортку і губить named-експорт `z`.
import * as z from 'zod'
import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'
import { defaultLocalProviders } from '@7n/llm-lib/local-providers'
import { startChain } from '@7n/llm-lib/chain'
import { resolveModel } from '@7n/llm-lib/model-tiers'

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
const RE_UPDATE_HEAD_LINE = /^##\s+Update[^\n]*\n+/
const RE_DECISION_SECTION = /##\s*Decision Outcome\s*([\s\S]{0,500})/i
const RE_NO_DECISION = /(не\s+обрано|не\s+прийнят|рішення\s+не\s+прийн|не\s+зроблен|no\s+decision|undecided)/i
const RE_FENCE_LEAD = /^\s*```/
const RE_FENCE_TRAIL = /```\s*$/
const RE_SESSION = /\bsession:\s/
const RE_STATUS = /\*\*Status:\*\*/
const RE_DATE = /\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/
const RE_TOKEN_SPLIT = /[^a-zа-яіїєґ0-9]+/i
const RE_DRAFT_ADR_TITLE = /^#{1,2}\s+ADR\s+(.+)$/m
const RE_YAML_FRONTMATTER = /^---\n([\s\S]*?)\n---/
const RE_TYPE_ADR = /^type:\s*ADR\s*$/m

/**
 * Прибирає code-fence-обгортку з LLM-відповіді.
 * @param {string} raw сира відповідь LLM
 * @returns {string} текст без обгортки code-fence
 */
const stripFence = raw => raw.replace(RE_FENCE_OPEN, '').replace(RE_FENCE_CLOSE, '').trim()
/**
 * Назва clean-ADR → людський заголовок (без .md і timestamp-префікса).
 * @param {string} s basename clean-ADR
 * @returns {string} людський заголовок
 */
const stripAdrName = s => s.replace(RE_MD_EXT, '').replace(RE_TS_PREFIX, '')

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
      .filter(t => t.length > 2 && !STOP.has(t))
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

const MADR_SECTION =
  /^(Context and Problem|Considered Options|Decision Outcome|Consequences|More Information|report|summary|Attempt|Reason|Update)\b/i

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
  const draftTok = drafts.map(d => tokenize(`${d.file} ${draftTitle(d.body)}`))
  const cleanTok = new Map(cleanList.map(c => [c, tokenize(c)]))

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

// ─────────────────────────── batch-каскад: спільна інфраструктура ──────────────

const resolvePreferredModel = () => resolveModel('min')

/**
 * Один `submitBatch`-виклик-хвиля на всі `items` разом. Провал САМОГО
 * виклику хвилі (напр. невалідний model-spec) не кидає далі — повертає
 * порожню мапу: викликач (`runCascade`) трактує це як "усі items цього тиру
 * невдалі" й іде до наступного тиру/fallback, той самий
 * graceful-degradation принцип, що й у попередньому `callWithCascade`.
 * @param {Array<{customId:string, prompt:string, system?:string}>} items items хвилі
 * @param {string} model model-spec тиру — порожній рядок пропускає хвилю без мережевого виклику
 * @param {{localProviders:object, submitBatchImpl:(model:string, items:Array<object>, opts?:object)=>Promise<Array<object>>}} cfg конфіг виклику
 * @returns {Promise<Map<string, {ok?:string, error?:string}>>} результати за `customId`
 */
async function runWave(items, model, cfg) {
  if (items.length === 0 || !model) return new Map()
  try {
    const results = await cfg.submitBatchImpl(model, items, { localProviders: cfg.localProviders })
    return new Map(results.map(r => [r.customId, r]))
  } catch {
    return new Map()
  }
}

/**
 * Спільний 2-хвильовий каскад для всіх 4 LLM-стадій: tier1-хвиля на ВСІ
 * items → ті, чия відповідь не пройшла `parse` (мережева помилка чи
 * невалідний вихід), ідуть у tier2-хвилю (лише якщо `cfg.allowCloud` і
 * `cfg.tier2` задано) → що лишилось невдалим — не потрапляє в результат
 * (caller застосовує свій callsite-специфічний conservative fallback).
 * @param {Array<{customId:string, prompt:string, system?:string}>} items усі items стадії
 * @param {(raw:string)=>any} parse валідатор/парсер відповіді (кидає на невалідному)
 * @param {{tier1:string, tier2:string, allowCloud:boolean, localProviders:object, submitBatchImpl:Function, stats:object}} cfg конфіг каскаду
 * @returns {Promise<Map<string, any>>} customId → розпарсений результат (лише items, що пройшли якийсь тир)
 */
async function runCascade(items, parse, cfg) {
  const parsed = new Map()
  if (items.length === 0) return parsed

  cfg.stats.localCalls += items.length
  const tier1Results = await runWave(items, cfg.tier1, cfg)
  const failed = []
  for (const item of items) {
    const r = tier1Results.get(item.customId)
    if (r?.ok) {
      try {
        parsed.set(item.customId, parse(r.ok))
        continue
      } catch {
        // невалідний вихід tier1 → кандидат на tier2 нижче
      }
    }
    failed.push(item)
  }

  if (failed.length > 0 && cfg.allowCloud && cfg.tier2) {
    cfg.stats.cloudCalls += failed.length
    cfg.stats.escalations += failed.length
    const tier2Results = await runWave(failed, cfg.tier2, cfg)
    for (const item of failed) {
      const r = tier2Results.get(item.customId)
      if (r?.ok) {
        try {
          parsed.set(item.customId, parse(r.ok))
        } catch {
          // невалідний вихід і на tier2 → лишається без результату, fallback у caller
        }
      }
    }
  }

  cfg.stats.failures += items.length - parsed.size
  return parsed
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
 * Одна пара-кандидат для edge-judge: draft↔draft (`kind:'dd'`) чи
 * draft↔clean (`kind:'dc'`) — з кількістю self-consistency голосів і
 * порогом впевненості для консенсусу.
 * @typedef {{ id: string, kind: 'dd'|'dc', aTitle: string, aBody: string, bTitle: string, bBody: string, votes: number, minConf: number, draftIdx?: number, cleanName?: string }} EdgeSpec
 */

/**
 * Будує кандидати-ребра Stage 1 у вигляді `EdgeSpec[]`: draft↔draft — 3
 * голоси/поріг 0.6 (харднінг #2, ризик over-merge вищий), draft↔clean —
 * `votes` голосів/поріг 0.5 (той самий дефолт, що й раніше в `judgeEdge`).
 * @param {[number,number][]} dd ребра draft-draft
 * @param {[number,string][]} dc ребра draft-clean
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} titles заголовки драфтів (той самий індекс, що й `drafts`)
 * @param {number} votes кількість голосів для draft↔clean
 * @returns {EdgeSpec[]} специфікації ребер для batch-хвилі
 */
function buildEdgeSpecs(dd, dc, drafts, titles, votes) {
  const specs = []
  for (const [i, j] of dd) {
    specs.push({
      id: `dd:${i}:${j}`,
      kind: 'dd',
      aTitle: titles[i],
      aBody: drafts[i].body,
      bTitle: titles[j],
      bBody: drafts[j].body,
      votes: 3,
      minConf: 0.6
    })
  }
  for (const [i, c] of dc) {
    const cTitle = stripAdrName(c)
    specs.push({
      id: `dc:${i}:${c}`,
      kind: 'dc',
      aTitle: titles[i],
      aBody: drafts[i].body,
      bTitle: cTitle,
      bBody: cTitle,
      votes,
      minConf: 0.5,
      draftIdx: i,
      cleanName: c
    })
  }
  return specs
}

/**
 * Розгортає `EdgeSpec[]` у плоский список batch-items — по одному на голос
 * (`<spec.id>::v<index>`), щоб self-consistency голоси йшли ОДНІЄЮ хвилею
 * разом з усіма іншими ребрами.
 * @param {EdgeSpec[]} specs специфікації ребер
 * @returns {Array<{customId:string, prompt:string, system:string}>} batch-items
 */
function edgeVoteItems(specs) {
  const items = []
  for (const spec of specs) {
    const user = `Запис A — "${spec.aTitle}":\n${spec.aBody.slice(0, 1500)}\n\n---\n\nЗапис B — "${spec.bTitle}":\n${spec.bBody.slice(0, 1500)}\n\nЦе одне й те саме рішення?`
    for (let v = 0; v < spec.votes; v++) {
      items.push({ customId: `${spec.id}::v${v}`, prompt: user, system: EDGE_SYS })
    }
  }
  return items
}

/**
 * Stage 1: судить усі ребра (draft↔draft і draft↔clean) ОДНИМ каскадом
 * голосів. Консервативний: `same` лише якщо ВСІ голоси кажуть same з
 * confidence ≥ `minConf` — голос без результату (обидва тири провалились)
 * трактується як `same:false` (conservative fallback), той самий принцип,
 * що й у попередньому послідовному `judgeEdge`.
 * @param {[number,number][]} dd ребра draft-draft
 * @param {[number,string][]} dc ребра draft-clean
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} titles заголовки драфтів
 * @param {{votes:number, allowCloud:boolean, tier1:string, tier2:string, localProviders:object, submitBatchImpl:Function, stats:object}} cfg конфіг каскаду
 * @returns {Promise<{ ddSame: Map<string, boolean>, cleanTarget: Array<string|null> }>} підтверджені draft-draft ребра й перший підтверджений clean-target на драфт
 */
async function judgeEdges(dd, dc, drafts, titles, cfg) {
  const specs = buildEdgeSpecs(dd, dc, drafts, titles, cfg.votes)
  const items = edgeVoteItems(specs)
  const parse = raw => EdgeSchema.parse(extractJson(raw))
  const parsed = await runCascade(items, parse, cfg)

  const ddSame = new Map()
  const cleanTargetCandidates = new Map() // draftIdx → [{cleanName, same}] у вхідному порядку кандидатів
  for (const spec of specs) {
    let sameCount = 0
    for (let v = 0; v < spec.votes; v++) {
      const vote = parsed.get(`${spec.id}::v${v}`) ?? { same: false, confidence: 0 }
      if (vote.same && vote.confidence >= spec.minConf) sameCount++
    }
    const same = sameCount === spec.votes
    if (spec.kind === 'dd') {
      ddSame.set(spec.id, same)
    } else {
      if (!cleanTargetCandidates.has(spec.draftIdx)) cleanTargetCandidates.set(spec.draftIdx, [])
      cleanTargetCandidates.get(spec.draftIdx).push({ cleanName: spec.cleanName, same })
    }
  }

  // Перший підтверджений кандидат у вхідному порядку — той самий вибір, що
  // й попередній послідовний break-on-first-match (тепер обчислений постфактум,
  // бо batch не може "зупинитись" на середині хвилі).
  const cleanTarget = Array.from({ length: drafts.length }).fill(null)
  for (const [draftIdx, candidates] of cleanTargetCandidates) {
    const hit = candidates.find(c => c.same)
    if (hit) cleanTarget[draftIdx] = hit.cleanName
  }

  return { ddSame, cleanTarget }
}

// ─────────────────────────── Stage 1b: kind-judge (LLM) ────────────────────────

const KindSchema = z.object({
  kind: z.enum(['standalone', 'trivial']),
  reason: z.string().min(3).max(400)
})

const KIND_SYS = `Ти оцінюєш чернетку архітектурного рішення (ADR). Визнач:
- "standalone" — це самостійне рішення, варте збереження як decision record.
- "trivial" — порожня / тривіальна / косметична / без реального рішення, можна видалити.

Поверни ЛИШЕ JSON: { "kind": "standalone"|"trivial", "reason": "<коротко українською>" }
Якщо сумніваєшся — "standalone" (краще зберегти).`

/**
 * Stage 1b: одна batch-хвиля kind-judge для ВСІХ драфтів, що лишились
 * одинаками без clean-target. Fallback (обидва тири провалились) —
 * `standalone` (той самий conservative-дефолт, що й раніше).
 * @param {number[]} draftIdxs індекси драфтів, що потребують kind-judge
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} titles заголовки драфтів
 * @param {object} cfg конфіг каскаду (див. `runCascade`)
 * @returns {Promise<Map<number, {kind:string, reason:string}>>} вердикт за індексом драфта
 */
async function judgeKinds(draftIdxs, drafts, titles, cfg) {
  const items = draftIdxs.map(i => ({
    customId: `kind:${i}`,
    prompt: `Чернетка — "${titles[i]}":\n${drafts[i].body.slice(0, 2500)}\n\nstandalone чи trivial?`,
    system: KIND_SYS
  }))
  const parse = raw => KindSchema.parse(extractJson(raw))
  const parsed = await runCascade(items, parse, cfg)

  const out = new Map()
  for (const i of draftIdxs) {
    out.set(i, parsed.get(`kind:${i}`) ?? { kind: 'standalone', reason: 'judge failed → conservative standalone' })
  }
  return out
}

// ─────────────────────────── Stage 2: gen-MADR (LLM) ───────────────────────────

const MADR_HEADINGS = ['## Context and Problem Statement', '## Considered Options', '## Decision Outcome', '## More Information']

/**
 * Детермінований гейт якості згенерованого MADR.
 * @param {string} content згенерований MADR-текст
 * @returns {{ok:boolean, errors:string[]}} результат перевірки та перелік порушень
 */
export function validateMadr(content) {
  const errors = []
  if (!content || content.length < 80) errors.push('too short')
  if (RE_FENCE_LEAD.test(content) || RE_FENCE_TRAIL.test(content.trim())) errors.push('code-fence wrapper')
  // OKF conformance: must have YAML frontmatter with type: ADR (not draft session: fields)
  const fmMatch = RE_YAML_FRONTMATTER.exec(content)
  if (!fmMatch || !RE_TYPE_ADR.test(fmMatch[1])) errors.push('missing OKF type: ADR frontmatter')
  if (RE_SESSION.test(content)) errors.push('leaked session: field')
  if (!RE_STATUS.test(content)) errors.push('missing Status')
  if (!RE_DATE.test(content)) errors.push('missing/!ISO Date')
  for (const h of MADR_HEADINGS) if (!content.includes(h)) errors.push(`missing heading ${h}`)
  return { ok: errors.length === 0, errors }
}

// Інверсія форматування: модель НЕ генерує markdown-каркас MADR (заголовок,
// Status/Date, назви секцій, fallback-фрази, шаблон "Chosen option…") — усе це
// детерміновано, тому його будує JS у assembleMadr(). Модель повертає ЛИШЕ
// контент секцій як вузький JSON — те, що справді треба "витягти" з чернетки.
// Контракт: модель віддає ЛИШЕ зміст секцій (значення полів — markdown-проза зі
// збереженим inline-кодом). Каркас (заголовок, Status/Date, назви секцій ##,
// fallback-фрази, шаблон "Chosen option…") будує assembleMadr() детерміновано —
// тому модель НЕ пише жодних ## і не торкається заголовка/дати/статусу.
const GEN_SYS = `Ти витягуєш зміст архітектурного рішення з чернетки ADR у JSON. Нічого не вигадуй — бери лише те, що є в чернетці.

{
  "context": "<2-4 речення: проблема й контекст рішення>",
  "options": ["<розглянутий варіант>", "..."],
  "chosen": "<обраний варіант, коротко>",
  "rationale": "<чому обрано саме його>",
  "good": ["<позитивний наслідок>", "..."],
  "bad": ["<негативний наслідок>", "..."],
  "more": "<файли/команди/API; можна кілька рядків і bullets>"
}

ВАЖЛИВО про значення полів:
- Зберігай inline-форматування: backticks навколо \`шляхів\`, \`назв.функцій()\`, \`команд\` — це частина змісту, не прибирай їх.
- НЕ додавай markdown-ЗАГОЛОВКИ (рядки з ##) і не пиши сам каркас (Status, Date, назви секцій) — лише зміст.
- Якщо чогось нема в чернетці — порожній рядок "" або порожній масив [].

Поверни ЛИШЕ JSON, без code-fence, без передмови.`

const slugify = title =>
  title
    .toLowerCase()
    .replace(RE_SLUG_NONWORD, '-')
    .replace(RE_LEAD_HYPHEN, '')
    .slice(0, 60)
    .replace(RE_TRAIL_HYPHEN, '') || 'adr'

const RE_FNAME_DATE = /^(\d{2})(\d{2})(\d{2})-/
const RE_TRAIL_DOT = /\.+\s*$/

/**
 * Детермінована ISO-дата для поля **Date:**. Пріоритет — `captured` frontmatter
 * (перші 10 символів ISO-стемпа); fallback — timestamp-префікс імені файлу
 * (`YYMMDD-…` → `20YY-MM-DD`). Каркас MADR не повинен залежати від LLM навіть тут.
 * @param {string|undefined} captured значення поля captured (ISO-рядок)
 * @param {string} [file] basename чернетки (для fallback-дати)
 * @returns {string} ISO-дата `YYYY-MM-DD` або '' якщо нічого не вдалося витягти
 */
export function madrDate(captured, file = '') {
  const iso = (captured ?? '').slice(0, 10)
  if (RE_DATE.test(`**Date:** ${iso}`)) return iso
  const m = file.match(RE_FNAME_DATE)
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : ''
}

const secStr = v => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim())
const secArr = v => (Array.isArray(v) ? v.map(secStr).filter(Boolean) : secStr(v) ? [secStr(v)] : [])

/**
 * Нормалізує сирий JSON-вивід gen-моделі у строгу форму секцій. Толерантна до
 * дрібних відхилень малої моделі: рядок замість масиву → масив із одного елемента,
 * число/null → рядок/порожньо, обрізає пробіли й порожні елементи.
 * @param {any} obj розпарсений JSON-обʼєкт від моделі
 * @returns {{context:string, options:string[], chosen:string, rationale:string, good:string[], bad:string[], more:string}} нормалізовані секції
 */
export function normalizeSections(obj) {
  return {
    context: secStr(obj?.context),
    options: secArr(obj?.options),
    chosen: secStr(obj?.chosen),
    rationale: secStr(obj?.rationale),
    good: secArr(obj?.good),
    bad: secArr(obj?.bad),
    more: secStr(obj?.more)
  }
}

/**
 * Детермінована збірка канонічного MADR 4.0.0 з заголовка, дати й секцій-контенту.
 * Увесь каркас (Status, назви секцій, шаблон "Chosen option…", fallback-фрази,
 * bullets) — тут, не в моделі. Заголовок і дата — JS-власність (draftTitle/captured),
 * модель їх не торкається.
 * @param {{title:string, date:string, sections:ReturnType<typeof normalizeSections>}} input заголовок, ISO-дата, нормалізовані секції
 * @returns {string} готовий MADR-markdown
 */
export function assembleMadr({ title, date, sections: s }) {
  // Знімаємо кінцеву крапку контенту, бо шаблон додає свою (інакше "..").
  const noDot = x => x.replace(RE_TRAIL_DOT, '')
  const optBlock = s.options.length ? s.options.map(o => `* ${o}`).join('\n') : 'Інші варіанти не обговорювалися.'
  const cons = [...s.good.map(g => `* Good, because ${noDot(g)}.`), ...s.bad.map(b => `* Bad, because ${noDot(b)}.`)]
  const consBlock = cons.length ? cons.join('\n') : 'Підтверджених наслідків не зафіксовано.'
  const outcome = s.chosen
    ? `Chosen option: "${s.chosen}"${s.rationale ? `, because ${noDot(s.rationale)}` : ''}.`
    : s.rationale
      ? `${noDot(s.rationale)}.`
      : 'Рішення зафіксовано у чернетці.'
  const titleYaml = title.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)
  return [
    '---',
    'type: ADR',
    `title: "${titleYaml}"`,
    '---',
    '',
    '**Status:** Accepted',
    `**Date:** ${date}`,
    '',
    '## Context and Problem Statement',
    s.context || 'Контекст не зафіксовано у чернетці.',
    '',
    '## Considered Options',
    optBlock,
    '',
    '## Decision Outcome',
    outcome,
    '',
    '### Consequences',
    consBlock,
    '',
    '## More Information',
    s.more || 'Додаткової інформації не зафіксовано.',
    ''
  ].join('\n')
}

/**
 * Stage 2: одна batch-хвиля gen-MADR для ВСІХ драфтів, вирішених як
 * `rewrite` (anchors + standalones). Модель лише витягує зміст секцій як
 * JSON; каркас збирає JS, результат проганяється через валідатор.
 * @param {number[]} draftIdxs індекси драфтів для генерації
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} titles заголовки драфтів
 * @param {string[]} captured `captured`-поле кожного драфта (для дати)
 * @param {object} cfg конфіг каскаду (див. `runCascade`)
 * @returns {Promise<Map<number, {content:string|null, slug:string, valid:boolean, error?:string}>>} результат gen-MADR за індексом драфта
 */
async function genMadrs(draftIdxs, drafts, titles, captured, cfg) {
  const items = draftIdxs.map(i => ({
    customId: `gen:${i}`,
    prompt: `Чернетка "${titles[i]}":\n\n${drafts[i].body.slice(0, 4000)}\n\nВитягни зміст рішення у JSON.`,
    system: GEN_SYS
  }))
  const parseFor = i => raw => {
    const sections = normalizeSections(extractJson(raw))
    if (!sections.context && !sections.chosen && !sections.rationale) {
      throw new Error('empty extraction (no context/decision)')
    }
    const content = assembleMadr({ title: titles[i], date: madrDate(captured[i], drafts[i].file), sections })
    const v = validateMadr(content)
    if (!v.ok) throw new Error(`MADR invalid: ${v.errors.join('; ')}`)
    return content
  }
  // parse залежить від `i` (title/date/file різні на item) — `keyedCascade`
  // (на відміну від `runCascade`) передає в parse і customId, тож резолвимо i звідти.
  const parse = (raw, customId) => parseFor(Number(customId.slice('gen:'.length)))(raw)
  const parsed = await keyedCascade(items, parse, cfg)

  const out = new Map()
  for (const i of draftIdxs) {
    const slug = slugify(titles[i])
    const content = parsed.get(`gen:${i}`)
    if (content) {
      out.set(i, { content, slug, valid: true })
    } else {
      cfg.stats.madrInvalid++
      out.set(i, { content: null, slug, valid: false, error: 'gen-MADR failed (both tiers)' })
    }
  }
  return out
}

/**
 * `runCascade`, але `parse` отримує і сирий текст, і `customId` — потрібно
 * там, де валідація/збірка залежить від того, ДО ЯКОГО саме item-у належить
 * відповідь (gen-MADR/gen-merge: title/date/file різні на кожен драфт).
 * @param {Array<{customId:string, prompt:string, system?:string}>} items усі items стадії
 * @param {(raw:string, customId:string)=>any} parse валідатор/парсер, що знає customId
 * @param {object} cfg конфіг каскаду
 * @returns {Promise<Map<string, any>>} customId → розпарсений результат
 */
async function keyedCascade(items, parse, cfg) {
  const parsed = new Map()
  if (items.length === 0) return parsed

  cfg.stats.localCalls += items.length
  const tier1Results = await runWave(items, cfg.tier1, cfg)
  const failed = []
  for (const item of items) {
    const r = tier1Results.get(item.customId)
    if (r?.ok) {
      try {
        parsed.set(item.customId, parse(r.ok, item.customId))
        continue
      } catch {
        // невалідний вихід tier1 → кандидат на tier2 нижче
      }
    }
    failed.push(item)
  }

  if (failed.length > 0 && cfg.allowCloud && cfg.tier2) {
    cfg.stats.cloudCalls += failed.length
    cfg.stats.escalations += failed.length
    const tier2Results = await runWave(failed, cfg.tier2, cfg)
    for (const item of failed) {
      const r = tier2Results.get(item.customId)
      if (r?.ok) {
        try {
          parsed.set(item.customId, parse(r.ok, item.customId))
        } catch {
          // невалідний вихід і на tier2 → лишається без результату
        }
      }
    }
  }

  cfg.stats.failures += items.length - parsed.size
  return parsed
}

// ─────────────────────────── Stage 3: gen-merge (LLM) ──────────────────────────

// Каркас merge-блоку («## Update <date>») — теж JS-власність. Модель пише ЛИШЕ
// новий зміст-прозу; заголовок із детермінованою датою додає JS нижче.
const MERGE_SYS = `Ти готуєш короткий додаток до існуючого ADR. Напиши ЛИШЕ новий зміст (проза/bullets), якого ще НЕМА в цільовому ADR — уточнення/виправлення/продовження. Стисло, українською, без заголовків, без code-fence, без передмови.`

/**
 * Stage 3: одна batch-хвиля gen-merge для ВСІХ драфтів, вирішених як
 * merge (у ціль-anchor чи в існуючий clean-ADR). Fallback (обидва тири
 * провалились) — канонічний заголовок без додаткового змісту.
 * @param {Array<{idx:number, targetTitle:string}>} entries драфт-індекс + заголовок цілі злиття
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} titles заголовки драфтів
 * @param {string[]} captured `captured`-поле кожного драфта
 * @param {object} cfg конфіг каскаду (див. `runCascade`)
 * @returns {Promise<Map<number, string>>} готовий merge-блок (`## Update <date>\n\n...`) за індексом драфта
 */
async function genMerges(entries, drafts, titles, captured, cfg) {
  const heads = new Map(entries.map(e => [e.idx, `## Update ${madrDate(captured[e.idx], drafts[e.idx].file)}`]))
  const items = entries.map(e => ({
    customId: `merge:${e.idx}`,
    prompt: `Цільовий ADR: "${e.targetTitle}".\nЧернетка-доповнення "${titles[e.idx]}" (${madrDate(captured[e.idx], drafts[e.idx].file)}):\n${drafts[e.idx].body.slice(0, 2500)}\n\nЛише новий зміст, без заголовка.`,
    system: MERGE_SYS
  }))
  const parse = (raw, customId) => {
    const idx = Number(customId.slice('merge:'.length))
    const t = stripFence(raw)
    // Захист від моделі, що все одно вписала свій заголовок: знімаємо його, щоб
    // не подвоїти. Канонічний head додаємо детерміновано нижче.
    const cleaned = RE_UPDATE_HEAD.test(t) ? t.replace(RE_UPDATE_HEAD_LINE, '').trim() : t
    if (!cleaned) throw new Error('empty merge additions')
    return `${heads.get(idx)}\n\n${cleaned}`
  }
  const parsed = await keyedCascade(items, parse, cfg)

  const out = new Map()
  for (const e of entries) {
    out.set(e.idx, parsed.get(`merge:${e.idx}`) ?? `${heads.get(e.idx)}\n\n(доповнення з чернетки "${titles[e.idx]}")`)
  }
  return out
}

// ─────────────────────────── union-find ────────────────────────────────────────

function makeDSU(n) {
  const p = Array.from({ length: n }, (_, i) => i)
  const find = x => (p[x] === x ? x : (p[x] = find(p[x])))
  const union = (a, b) => {
    p[find(a)] = find(b)
  }
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
 * @param {{allowCloud?:boolean, votes?:number, onProgress?:(m:string)=>void, chainFactory?:typeof startChain, tier1?:string, tier2?:string, localProviders?:object, submitBatchImpl?:Function}} [opts] хмарна ескалація, кількість голосів, колбек прогресу, фабрика ланцюжка (інжект для тестів), override моделей/local-providers/submitBatch (інжект для тестів)
 * @returns {{operations:object[], stats:object, trace:object}} операції apply-ops, лічильники та діагностичний trace
 */
export async function normalizePipeline(drafts, cleanList, opts = {}) {
  // Один ланцюжок на весь прогін: batch-хвилі не мають per-item-гранулярності
  // (submitBatch не приймає chain на item), тож chain лишається
  // прогін-рівневим — той самий tradeoff, що й у doc-files batch-шляху (T8).
  const chain = (opts.chainFactory ?? startChain)({
    kind: 'adr-normalize',
    unit: `batch:${drafts.length}`,
    cwd: process.cwd()
  })
  try {
    const result = await normalizePipelineCore(drafts, cleanList, opts, chain)
    chain.end({
      outcome: result.stats.failures > 0 || result.stats.madrInvalid > 0 ? 'partial' : 'success',
      extra: { drafts: drafts.length, ops: result.operations.length, stats: result.stats }
    })
    return result
  } catch (error) {
    chain.end({ outcome: 'fail', extra: { drafts: drafts.length, error: String(error.message ?? error).slice(0, 200) } })
    throw error
  }
}

/**
 * Тіло конвеєра (chain належить обгортці normalizePipeline).
 * @param {{file:string, body:string}[]} drafts батч чернеток
 * @param {string[]} cleanList clean basename-и
 * @param {{allowCloud?:boolean, votes?:number, onProgress?:(m:string)=>void, tier1?:string, tier2?:string, localProviders?:object, submitBatchImpl?:Function}} opts опції прогону
 * @param {object} chain chain handle
 * @returns {Promise<{operations:object[], stats:object, trace:object}>} результат конвеєра
 */
async function normalizePipelineCore(drafts, cleanList, opts, chain) {
  const allowCloud = opts.allowCloud ?? false
  const log = opts.onProgress ?? noop
  const stats = { localCalls: 0, cloudCalls: 0, escalations: 0, failures: 0, madrInvalid: 0 }
  const cfg = {
    allowCloud,
    votes: opts.votes ?? 2,
    stats,
    chain,
    tier1: opts.tier1 ?? resolvePreferredModel(),
    tier2: opts.tier2 ?? resolveModel('N_CLOUD_MIN_MODEL'),
    localProviders: opts.localProviders ?? defaultLocalProviders(),
    submitBatchImpl: opts.submitBatchImpl ?? submitBatchNative
  }

  const titles = drafts.map(d => draftTitle(d.body) || d.file.replace(RE_MD_EXT, ''))
  const captured = drafts.map(d => captureField(d.body, 'captured'))

  // Харднінг #1: детермінований no-decision гейт. Такі драфти не кластеризуємо й
  // не rewrite-имо — одразу delete (без LLM), як це робить gold.
  const noDec = drafts.map(d => isNoDecision(d.body))
  if (noDec.some(Boolean)) log(`no-decision гейт: ${noDec.filter(Boolean).length} драфт(ів) → delete`)

  // Stage 0: retrieval (ребра, що торкаються no-decision драфтів, відкидаємо)
  const edges = buildEdges(drafts, cleanList)
  const dd = edges.dd.filter(([i, j]) => !noDec[i] && !noDec[j])
  const dc = edges.dc.filter(([i]) => !noDec[i])
  log(`retrieval: ${dd.length} draft-draft ребер, ${dc.length} draft-clean кандидатів`)

  // Stage 1: одна batch-хвиля на ВСІ ребра (dd + dc, усі self-consistency голоси разом)
  const dsu = makeDSU(drafts.length)
  const { ddSame, cleanTarget } = await judgeEdges(dd, dc, drafts, titles, cfg)
  let confirmedDDCount = 0
  for (const [i, j] of dd) {
    if (ddSame.get(`dd:${i}:${j}`)) {
      dsu.union(i, j)
      confirmedDDCount++
    }
  }
  log(`edge-judge: ${confirmedDDCount}/${dd.length} draft-draft ребер підтверджено`)
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
      const live = members.filter(m => !noDec[m])
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
        decision[m] = noDec[m]
          ? { op: 'delete', reason: 'рішення не прийняте (transcript обірвався)' }
          : { op: 'merge-anchor', anchorIdx: anchor }
      }
    } else {
      const i = members[0]
      if (noDec[i]) decision[i] = { op: 'delete', reason: 'рішення не прийняте (transcript обірвався)' }
      else if (cleanTarget[i]) decision[i] = { op: 'merge-existing', target: cleanTarget[i] }
      else decision[i] = { op: 'kind' }
    }
  }

  // Stage 1b: одна batch-хвиля kind-judge для ВСІХ одинаків без clean-target
  const kindIdxs = []
  for (let i = 0; i < drafts.length; i++) if (decision[i].op === 'kind') kindIdxs.push(i)
  if (kindIdxs.length > 0) {
    const kinds = await judgeKinds(kindIdxs, drafts, titles, cfg)
    for (const i of kindIdxs) {
      const k = kinds.get(i)
      decision[i] = k.kind === 'trivial' ? { op: 'delete', reason: k.reason } : { op: 'rewrite' }
    }
  }

  // Stage 2: одна batch-хвиля gen-MADR для ВСІХ rewrite (anchors + standalones)
  const slugByIdx = Array.from({ length: drafts.length }).fill(null)
  const rewriteIdxs = []
  for (let i = 0; i < drafts.length; i++) if (decision[i].op === 'rewrite') rewriteIdxs.push(i)
  if (rewriteIdxs.length > 0) {
    const gens = await genMadrs(rewriteIdxs, drafts, titles, captured, cfg)
    for (const i of rewriteIdxs) {
      const g = gens.get(i)
      slugByIdx[i] = g.slug
      if (g.valid) {
        operations.push({ op: 'rewrite', file: drafts[i].file, slug: g.slug, content: g.content })
      } else {
        decision[i] = { op: 'gen-failed' }
        log(`gen-MADR FAILED для ${drafts[i].file}: ${g.error}`)
      }
    }
  }

  // Stage 3: одна batch-хвиля gen-merge для ВСІХ merge (anchor + existing)
  const mergeEntries = []
  for (let i = 0; i < drafts.length; i++) {
    const d = decision[i]
    if (d.op === 'merge-anchor') {
      const slug = slugByIdx[d.anchorIdx]
      if (!slug) {
        log(`merge-anchor ${drafts[i].file}: anchor gen failed → skip`)
        continue
      }
      mergeEntries.push({ idx: i, targetTitle: titles[d.anchorIdx], targetFile: `${slug}.md` })
    } else if (d.op === 'merge-existing') {
      mergeEntries.push({ idx: i, targetTitle: stripAdrName(d.target), targetFile: d.target })
    } else if (d.op === 'delete') {
      operations.push({ op: 'delete', file: drafts[i].file, reason: d.reason })
    }
  }
  if (mergeEntries.length > 0) {
    const merges = await genMerges(mergeEntries, drafts, titles, captured, cfg)
    for (const e of mergeEntries) {
      operations.push({ op: 'merge-into', file: drafts[e.idx].file, target: e.targetFile, additions: merges.get(e.idx) })
    }
  }

  const trace = {
    titles,
    clusters: Array.from(clusters.values(), m => m.map(i => drafts[i].file)),
    cleanTargets: cleanTarget.map((c, i) => (c ? [drafts[i].file, c] : null)).filter(Boolean),
    decisions: decision.map((d, i) => [drafts[i].file, d.op])
  }
  return { operations, stats, trace }
}
