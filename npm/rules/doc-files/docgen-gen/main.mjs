/** @see ./docs/docgen-gen.md */
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { env } from 'node:process'
import { resolveModel } from '@7n/llm-lib/model-tiers'
import { runOneShot } from '@7n/llm-lib/one-shot'
import { startChain } from '@7n/llm-lib/chain'
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { docPathForSource } from '../docgen-scan/main.mjs'
import { loadDocFilesExtractors } from '../docgen-scan/lang-extensions.mjs'
import { extractAnchors, anchorTokens } from '../docgen-extract-anchors/main.mjs'
import { QUALITY_THRESHOLD } from '../docgen-crc/main.mjs'
import { JUDGE_ENABLED, JUDGE_MODEL, detectRefusalFiller, judgeDoc, judgeFailsDoc } from '../docgen-judge/main.mjs'
import {
  oneShotMessages,
  sectionMessages,
  overviewMessages,
  criticMessages,
  refineMessages,
  guaranteesFromMarkers,
  isApiGap,
  renderApiLine,
  apiGapMessages,
  buildUnitDigest,
  UNIT_DIGEST_TOKENS,
  judgeRefineMessages
} from '../docgen-prompts/main.mjs'

/** Облік LLM-викликів і часу в них у межах однієї генерації (скидається на старті generateDoc). */
let llmMeter = { calls: 0, ms: 0 }

/**
 * Ланцюжок поточної генерації (@7n/llm-lib/chain) — той самий lifecycle, що й
 * llmMeter: виставляється на старті generateDoc, скидається у finally. Генерація
 * одного файлу послідовна, тому module-level стан без гонок.
 */
let activeChain = null

/**
 * Дедлайн поточної генерації (epoch ms) — той самий lifecycle, що й activeChain:
 * виставляється на старті generateDoc (opts.deadlineAt від fix-pipeline), скидається
 * у finally. Ріже per-call таймаути так, що жоден LLM-виклик не переживає бюджет
 * рунга — інакше backstop runner-а вбиває worker, а батч-зомбі продовжує дзвонити
 * в локальну модель поверх наступного rung-а.
 */
let activeDeadlineAt = null

/**
 * Ріже базовий per-call таймаут під залишок бюджету до дедлайну.
 * Без дедлайну — базовий ліміт; після дедлайну — 0 (виклик не має стартувати).
 * @param {number} baseMs базовий ліміт виклику
 * @param {number|null} deadlineAt дедлайн (epoch ms) або null
 * @param {number} [now] поточний час (інжект для тестів)
 * @returns {number} ефективний ліміт у мс (0 — бюджет вичерпано)
 */
export function capTimeoutToDeadline(baseMs, deadlineAt, now = Date.now()) {
  if (!deadlineAt) return baseMs
  return Math.min(baseMs, Math.max(0, deadlineAt - now))
}

/**
 * Обгортка LLM-виклику з обліком (тепер async поверх pi-one-shot): лічить кількість
 * викликів і сумарний час. Генерація одного файлу послідовна — лічильник без гонок.
 * Зберігає старий інтерфейс accountant'а: повертає рядок-вміст, кидає на помилці.
 * Таймаут виклику ріжеться під activeDeadlineAt; вичерпаний бюджет — помилка зі
 * словом «timeout» (класифікується transient у batch, не permanent/systemic).
 * @param {Array<{role:string,content:string}>} messages чат-повідомлення
 * @param {string} model model-id (`provider/id`)
 * @param {{ timeoutMs?: number, caller?: string }} [opts] ліміт/мітка (temperature/maxTokens не підтримуються pi-one-shot)
 * @returns {Promise<string>} відповідь моделі
 */
async function callLlm(messages, model, opts = {}) {
  const timeoutMs = capTimeoutToDeadline(opts.timeoutMs ?? LOCAL_TIMEOUT_MS, activeDeadlineAt)
  if (timeoutMs <= 0) {
    throw new Error('docgen deadline: бюджет рунга fix-pipeline вичерпано до старту LLM-виклику (timeout)')
  }
  const started = Date.now()
  try {
    const res = await runOneShot({
      messages,
      modelSpec: model,
      timeoutMs,
      caller: opts.caller ?? 'docgen',
      chain: activeChain
    })
    if (res.error) throw new Error(res.error)
    return res.content
  } finally {
    llmMeter.calls += 1
    llmMeter.ms += Date.now() - started
  }
}

const FENCE_OPEN_RE = /^```[a-z]*\n?/
const FENCE_CLOSE_RE = /\n?```\s*$/
const LEADING_HEADING_RE = /^#{1,6}[ \t]{1,8}[^\n]{0,400}\n{1,8}/
// R9: чат-преамбули малих моделей — «озвучування завдання» перед відповіддю
// («Ось оновлена чорнетка секції…», «Як технічний письменник, я створю…»,
// «Оновлений текст секції:»). Живі приклади — прогін gemma-4 по efes/backend
// 2026-07-21: 4 з 10 доків мали такі рядки; R8 (refusal) їх не ловить, бо далі
// йде реальний контент. Зрізаються ЛИШЕ провідні рядки секції (мета-нарація
// стоїть попереду), щоб не зачепити легітимний текст усередині.
const PREAMBLE_LINE_RES = [
  /^Ось (?:оновлен|переписан|виправлен|готов|вміст|текст|чорнетк|секці)/i,
  /^Оновлен(?:ий|а|е|о) (?:текст|чорнетк|секці|вміст|версі)/i,
  /^Як технічний письменник/i,
  /^(?:Я )?(?:створю|напишу|перепишу|підготую) /i,
  /^(?:Звісно|Гаразд|Добре)[,.!]/i,
  /^(?:Нижче наведено|Нижче — )/i
]
// Дубль назви секції першим рядком тіла («Поведінка:» всередині секції Поведінка).
// Рядок перед перевіркою вже пройшов trim (див. stripLeadingPreamble) — без \s*-країв.
const SECTION_LABEL_LINE_RE = /^(?:Огляд|Поведінка|Публічний API|Гарантії поведінки):?$/
const SECTION_HEADING_RE = /^##\s+(.+)/
const SECTION_KEY_CLEAN_RE = /[^а-яіїєґa-z0-9]/gi
const CACHE_MENTION_RE = /кеш/i
const CACHE_NEGATION_RE = /(?:не|без)\s+(?:\S+\s+)?кеш|немає\s+кеш/i
const CRITIC_NONE_RE = /^\s*NONE\s*$/i
// R4: абстрактні «нічого-не-кажучі» формули, які обходять exact-blocklist і дають score=100.
// Масив дрібних патернів замість однієї alternation-regex (sonarjs/regex-complexity); .some() еквівалентний.
const GENERIC_RES = [
  /відповідност\S*\s+(?:даних\s+)?(?:визначеному\s+)?контракту/i,
  /валідаці\S*\s+даних/i,
  /перевірк\S*\s+(?:відповідності\s+)?даних/i,
  /обробк\S*\s+даних/i,
  /застосову\S*\s+логіку/i,
  /інспекту\S*\s+та\s+збира\S*\s+дан/i
]
// R7: часті русизми/суржик (курований безпечний список — без false-positive на нормальній мові).
// Без \b: кирилиця не є ASCII-`\w`, тож межі слова в JS-regex не спрацьовують — терміни специфічні.
const SURZHIK_RE =
  /пропуская|являється|в залежності|по замовчуванню|на протязі|відповідаюч|слідуюч|наступним разом|приймати участь|у відповідності/i
const ANCHOR_MISS_PENALTY = 5
const ANCHOR_MISS_CAP = 20
// Захищена людино-керована секція (Варіант B): дослівно зберігається, ніколи не
// перезаписується LLM-виходом, виключена зі скорингу. Opt-in = сам факт наявності.
const PROTECTED_HEADING = 'Призначення'
const PROTECTED_START_RE = /^##\s+Призначення\s*$/
const H2_RE = /^##\s/
const H1_RE = /^#\s/

/**
 * R9: зрізає провідні чат-преамбули й дубль назви секції з початку тексту.
 * Ітерується, поки перший непорожній рядок лишається мета-нарацією — модель
 * інколи ставить дві поспіль («Як технічний письменник…» + «Ось оновлений…»).
 * @param {string} t текст після базового очищення
 * @returns {string} текст без провідних мета-рядків
 */
export function stripLeadingPreamble(t) {
  let out = t
  for (;;) {
    const nl = out.indexOf('\n')
    const first = (nl === -1 ? out : out.slice(0, nl)).trim()
    const isMeta = SECTION_LABEL_LINE_RE.test(first) || PREAMBLE_LINE_RES.some(re => re.test(first))
    if (!first || !isMeta || nl === -1) return isMeta && nl === -1 ? '' : out
    out = out.slice(nl + 1).trimStart()
  }
}

/**
 * Прибирає код-фенс-обгортку (потрійні бектіки), випадковий провідний
 * `##`-заголовок і чат-преамбули (R9) із секції.
 * @param {string} text сирий вихід моделі
 * @returns {string} очищений текст секції
 */
function stripSection(text) {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(FENCE_OPEN_RE, '').replace(FENCE_CLOSE_RE, '').trim()
  }
  t = t.replace(LEADING_HEADING_RE, '') // зрізати випадковий заголовок
  return stripLeadingPreamble(t.trim()).trim()
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
 * Відокремлює захищену секцію `## Призначення` (Варіант B). Межа — наступний `## `
 * (H2); `###`+ усередині не обривають блок.
 * @param {string} md документ
 * @returns {{ body: string|null, without: string }} тіло блоку (або null) і md без нього
 */
export function splitProtected(md) {
  const lines = md.split('\n')
  const start = lines.findIndex(l => PROTECTED_START_RE.test(l))
  if (start === -1) return { body: null, without: md }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i])) {
      end = i
      break
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
  const without = [...lines.slice(0, start), ...lines.slice(end)].join('\n')
  return { body: body || null, without }
}

/**
 * Вставляє захищений блок `## Призначення` одразу після H1 (фіксована позиція).
 * @param {string} md машинно-згенерований документ (без блоку)
 * @param {string|null} intent тіло блоку або null
 * @returns {string} документ із блоком (або без змін, якщо intent порожній)
 */
export function insertProtected(md, intent) {
  if (!intent) return md
  const lines = md.split('\n')
  const h1 = lines.findIndex(l => H1_RE.test(l))
  const at = h1 === -1 ? 0 : h1 + 1
  lines.splice(at, 0, '', `## ${PROTECTED_HEADING}`, '', intent)
  return lines.join('\n')
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
 * R6: штраф за службові (неекспортовані) символи, подані як публічні.
 * @param {object} facts факт-лист про файл
 * @param {{ overview: string, behavior: string, api: string, guarantees: string }} secs тексти секцій
 * @param {string[]} issues акумулятор кодів проблем (мутується)
 * @returns {number} сумарний штраф (≥0)
 */
function internalSymbolPenalty(facts, { overview, behavior, api, guarantees }, issues) {
  let penalty = 0
  for (const sym of [...(facts.internalSymbols ?? []), ...(facts.localSymbols ?? [])]) {
    const inDoc = hasName(guarantees, sym) || hasName(overview, sym) || hasName(behavior, sym) || hasName(api, sym)
    if (inDoc) {
      penalty += 10
      issues.push(`internal-name:${sym}`)
    }
  }
  return penalty
}

/**
 * R5: штраф за відсутні в документі валідні анкори (дослівні підрядки src).
 * @param {string} md зібраний документ
 * @param {object} anchors анкори файлу
 * @param {string} src вміст файлу
 * @param {string[]} issues акумулятор кодів проблем (мутується)
 * @returns {number} штраф, обмежений ANCHOR_MISS_CAP
 */
function anchorMissPenalty(md, anchors, src, issues) {
  let penalty = 0
  for (const tok of anchorTokens(anchors)) {
    if (!src.includes(tok)) continue // валідність: фейковий анкор не вимагаємо
    if (!md.includes(tok) && penalty < ANCHOR_MISS_CAP) {
      penalty += ANCHOR_MISS_PENALTY
      issues.push(`anchor-miss:${tok}`)
    }
  }
  return penalty
}

/**
 * Stage 2.5 — детермінований скоринг (0 токенів): перевіряє вихід проти фактів.
 * @param {string} md зібраний документ
 * @param {object} facts факт-лист про файл
 * @param {{ anchors?: object|null, src?: string }} [ctx] анкори й джерело для R5
 * @returns {{ score: number, issues: string[] }} оцінка 0–100 і коди проблем
 */
export function scoreDoc(md, facts, { anchors = null, src = '' } = {}) {
  const s = parseSections(md)
  let score = 100
  const issues = []
  const overview = s['огляд'] ?? ''

  // R8: refusal/чат-філер моделі («Я готовий писати…», «Надайте мені код…») —
  // детермінований пре-гейт перед judge: форсує degraded незалежно від решти оцінки
  // (штраф −100 → score 0), і judge (що працює лише на score ≥ поріг) не викликається.
  // Захищене людське «Призначення» виключене з перевірки.
  if (detectRefusalFiller(splitProtected(md).without)) {
    score -= 100
    issues.push('refusal-filler')
  }

  // R9: чат-преамбула в тілі («Ось оновлена чорнетка…», «Як технічний письменник…»)
  // — на відміну від R8, далі є реальний контент, тож не 0, а відчутний штраф:
  // best-of-2 обере чистий драфт, а стійке сміття помітить degraded-доретрай.
  // stripSection зрізає провідні мета-рядки на генерації; скорер — страховка для
  // one-shot шляху і преамбул усередині секції (після першого рядка).
  for (const line of splitProtected(md).without.split('\n')) {
    if (PREAMBLE_LINE_RES.some(re => re.test(line.trim()))) {
      score -= 25
      issues.push('chat-preamble')
      break
    }
  }

  if (!s['огляд']) {
    score -= 25
    issues.push('no-overview')
  }

  // R4: generic-Огляд (парафрази, які обходять exact-blocklist) — як майже-відсутній.
  if (GENERIC_RES.some(re => re.test(overview))) {
    score -= 35
    issues.push('generic-overview')
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

  // R6: службові (неекспортовані) функції не мають фігурувати як публічні
  const api = s['публічнийapi'] ?? ''
  score -= internalSymbolPenalty(facts, { overview, behavior, api, guarantees }, issues)

  // R5: кожен валідний анкор (дослівний підрядок src) має зʼявитися в документі
  if (anchors && src) {
    score -= anchorMissPenalty(md, anchors, src, issues)
  }

  // R7: суржик/русизми — лише в машинних секціях (захищене «Призначення» — людське, не штрафуємо)
  if (SURZHIK_RE.test(splitProtected(md).without)) {
    score -= 10
    issues.push('surzhik')
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
async function critiqueRefineSection(sectionKey, draft, facts, anchors, model, timeoutMs) {
  const critiqueRaw = await callLlm(criticMessages(sectionKey, draft, facts, anchors), model, { timeoutMs })
  const critique = critiqueRaw.trim()
  if (!critique || CRITIC_NONE_RE.test(critique) || critique.length < 12) return draft
  const refinedRaw = await callLlm(refineMessages(sectionKey, draft, critique, facts, anchors), model, { timeoutMs })
  const refined = refinedRaw.trim()
  return stripSignatures(stripSection(refined)) || draft
}

/**
 * Stage 1/3 (гібрид doc-files, ADR 260719-2155): «Публічний API» — покриті
 * JSDoc-описом експорти рендеряться дослівно (`renderApiLine`, 0 токенів, 0
 * галюцинацій), LLM викликається лише на прогалини (`isApiGap`). Якщо прогалин
 * немає — секція збирається БЕЗ жодного LLM-виклику. Єдиний непокритий
 * експорт (як і раніше) лишається описаним лише в Поведінці — окремого виклику
 * на секцію з одного рядка не варте.
 * @param {object} facts факт-лист
 * @param {object|null} anchors анкори файлу
 * @param {string} model model-id
 * @param {number} timeoutMs ліміт на LLM-виклик
 * @param {number} [temperature] температура LLM-виклику (best-of-2 підвищує)
 * @returns {Promise<string>} текст секції «Публічний API» (може бути порожнім рядком)
 */
export async function buildApiSection(facts, anchors, model, timeoutMs, temperature = 0.2) {
  const exps = facts.exports ?? []
  if (!exps.length) return ''
  if (exps.length === 1 && isApiGap(exps[0])) return ''
  const covered = exps.filter(e => !isApiGap(e))
  const gap = exps.filter(isApiGap)
  const coveredBlock = covered.map(e => renderApiLine(e)).join('\n')
  if (!gap.length) return coveredBlock
  let gapDraft = stripSignatures(
    stripSection(await callLlm(apiGapMessages(gap, anchors), model, { timeoutMs, temperature }))
  )
  // E2: critique→refine лише коли ВСІ експорти — прогалина (там модель найбільш
  // схильна зривати на generic-фрази без жодного JSDoc-«якоря» поруч).
  if (gap.length === exps.length) {
    gapDraft = await critiqueRefineSection('api', gapDraft, facts, anchors, model, timeoutMs)
  }
  return [coveredBlock, gapDraft].filter(Boolean).join('\n')
}

/**
 * One-shot: один виклик LLM на весь документ (для unsupported-структур).
 * @param {object} facts факт-лист
 * @param {string} src вміст файлу
 * @param {string} model model-id
 * @param {number} [timeoutMs] ліміт на виклик
 * @param {{ intent?: string|null }} [opts] захищена секція «Призначення» для збереження
 * @returns {{ md: string }} зібраний документ
 */
async function oneShotDoc(facts, src, model, timeoutMs = LOCAL_TIMEOUT_MS, { intent = null } = {}) {
  const text = await callLlm(oneShotMessages(facts, src), model, { timeoutMs })
  let md = stripSignatures(stripSection(text))
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  return { md: insertProtected(md + '\n', intent) }
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
 * @param {{ anchors?: object|null, temperature?: number, intent?: string|null }} [opts] анкори, температура, захищена секція як контекст
 * @returns {{ md: string }} зібраний документ
 */
async function orchestratedDoc(
  facts,
  src,
  model,
  timeoutMs,
  { anchors = null, temperature = 0.2, intent = null } = {}
) {
  const sections = {}
  const anc = anchors ?? extractAnchors(src)
  // E3: «Гарантії» — детермінований шаблон з markers (0 LLM-запитів, 0 generic-фраз)
  sections.guarantees = guaranteesFromMarkers(facts)
  // Спершу Поведінка — єдина секція з кодом (sectionMessages повертає лише її)
  for (const s of sectionMessages(facts, src, anc, intent)) {
    sections[s.key] = stripSignatures(stripSection(await callLlm(s.messages, model, { timeoutMs, temperature })))
  }
  // Stage 1/3: «Публічний API» — покриті JSDoc експорти дослівно, LLM лише на прогалини
  sections.api = await buildApiSection(facts, anc, model, timeoutMs, temperature)
  // R3: «Огляд» — ОСТАННІМ, узагальненням уже написаної Поведінки (не голого факт-листа)
  let overview = stripSignatures(
    stripSection(
      await callLlm(overviewMessages(facts, sections.behavior ?? '', intent), model, { timeoutMs, temperature })
    )
  )
  // №8: анкори лише в Behavior — критик Огляду без анкор-блоку, інакше refine
  // «поверне» анкор у Огляд і в документі він знову зʼявиться двічі.
  overview = await critiqueRefineSection('overview', overview, facts, null, model, timeoutMs)
  sections.overview = overview
  // Варіант B: дослівно повертаємо захищений блок у фіксовану позицію
  return { md: insertProtected(assemble(basename(facts.relPath), sections), intent) }
}

/**
 * №6 — judge-refine: суддя назвав конкретні неточності (`judge.reason`) — один
 * локальний refine-прохід замість лише маркування degraded. Приймаємо виправлену
 * версію ТІЛЬКИ якщо: det-score не впав, усі ## заголовки збережені, і повторний
 * суддя більше не каже inaccurate. Інакше — оригінал і degraded, як раніше.
 * Cap: рівно одна ітерація (без петель самопереконання).
 * @param {{ md: string }} r поточний результат генерації
 * @param {{ reason: string }} judge вердикт судді (inaccurate)
 * @param {{ facts: object, anchors: object|null, src: string, score: number, model: string, chain: object }} ctx контекст генерації
 * @returns {Promise<{ md: string, score: number, issues: string[], judge: object }|null>} прийнята виправлена версія або null (лишаємо оригінал)
 */
async function judgeRefinePass(r, judge, { facts, anchors, src, score, model, chain }) {
  const { body: intentBody, without } = splitProtected(r.md)
  const fixedRaw = await callLlm(judgeRefineMessages(without, judge.reason), model, { timeoutMs: LOCAL_TIMEOUT_MS })
  let fixed = stripSection(fixedRaw)
  if (!fixed.startsWith('#')) fixed = `# ${basename(facts.relPath)}\n\n${fixed}`
  const fixedMd = insertProtected(fixed + '\n', intentBody)
  // Guard 1: рерайт не має губити секції (малі моделі інколи повертають фрагмент)
  const origHeadings = r.md.match(/^##\s.+$/gm) ?? []
  if (origHeadings.some(h => !fixedMd.includes(h))) return null
  // Guard 2: det-score не має падати
  const sFixed = scoreDoc(fixedMd, facts, { anchors, src })
  if (sFixed.score < score) return null
  // Guard 3: повторний суддя (той самий scope: inaccurate)
  const judge2 = { ...(await judgeDoc(src, fixedMd, { chain })), model: JUDGE_MODEL }
  if (judgeFailsDoc(judge2)) return null
  return { md: fixedMd, score: sFixed.score, issues: sFixed.issues, judge: judge2 }
}

/**
 * Judge-гейт цілком (виклик судді + опційний №6 refine): обгортка для
 * generateDocCore, щоб тримати його cognitive complexity в межах. Помилки судді
 * не валять генерацію — лише issue-маркер, як і раніше.
 * @param {{ r: {md: string}, score: number, issues: string[], facts: object, anchors: object|null, src: string, model: string, chain: object }} ctx стан генерації
 * @returns {Promise<{ judge: object|null, r: {md: string}, score: number, issues: string[] }>} оновлений стан
 */
async function runJudgeGate({ r, score, issues, facts, anchors, src, model, chain }) {
  let judge = null
  try {
    judge = { ...(await judgeDoc(src, r.md, { chain })), model: JUDGE_MODEL }
    // №6: суддя назвав конкретні неточності → один локальний refine-прохід
    // (опт-аут: N_CURSOR_DOCGEN_JUDGE_REFINE=0). Прийнято лише коли всі
    // guard-и judgeRefinePass пройдені; інакше — degraded, як раніше.
    if (judgeFailsDoc(judge) && env.N_CURSOR_DOCGEN_JUDGE_REFINE !== '0') {
      const refined = await judgeRefinePass(r, judge, { facts, anchors, src, score, model, chain })
      if (refined) {
        r = { ...r, md: refined.md }
        score = refined.score
        issues = [...refined.issues, 'judge-refine:won']
        judge = refined.judge
      } else {
        issues = [...issues, 'judge-refine:kept-original']
      }
    }
    if (judgeFailsDoc(judge)) issues = [...issues, `judge:inaccurate:${judge.confidence}`]
  } catch (error) {
    issues = [...issues, `judge:error: ${error.message.slice(0, 80)}`]
  }
  return { judge, r, score, issues }
}

/**
 * №5 (бенч gemma-4): текст «коду файлу» для Behavior-промпта. Великий src
 * (понад UNIT_DIGEST_TOKENS) → юніт-дайджест (імʼя + JSDoc + call-graph + тіло
 * лише для непокритих юнітів) замість сирого коду: на ~6k токенів сирцю мала
 * модель втрачає фокус і пише водянисто. Анкори/CRC — завжди від повного src
 * (дайджест лише для промпта). units нема (парсинг упав чи мова без юніт-шару)
 * — повний src, як раніше.
 * @param {{ facts: object, estTokens: number, langExtractors: Map<string, object>, ext: string, src: string, file: string }} ctx контекст генерації
 * @returns {string} повний src або юніт-дайджест
 */
function resolvePromptSrc({ facts, estTokens, langExtractors, ext, src, file }) {
  if (facts.unsupported || estTokens <= UNIT_DIGEST_TOKENS) return src
  const units = langExtractors.get(ext)?.extractUnits?.(src, file)
  if (!units?.length) return src
  // Гейт змістовності (фінальний бенч, upsert-order 23KB): дайджест виграє лише
  // коли файл СТРУКТУРОВАНИЙ (декілька юнітів — call-graph несе інформацію) і
  // більшість юнітів покриті JSDoc. Інакше він вироджений: (а) юніти без JSDoc →
  // обрізані тіла без описів → Поведінка стискається до generic (246 знаків
  // проти 1300+ на повному src, score 65); (б) один гігантський юніт → дайджест
  // = один рядок JSDoc, вся логіка невидима. В обох випадках — повний src.
  const covered = units.filter(u => u.doc).length
  const structured = units.length >= 4 && covered / units.length >= 0.6
  return structured ? buildUnitDigest(units) : src
}

/** Максимальний час генерації одного LLM-виклику. */
const LOCAL_TIMEOUT_MS = 5 * 60 * 1000

/** Контекстне вікно локальної моделі в токенах (оцінка; override — N_CURSOR_DOCGEN_CTX). */
const DEFAULT_CONTEXT_TOKENS = 131072

/**
 * Бюджет токенів на джерело: половина контекстного вікна (решта — факти/стиль/вихід).
 * Перевищення → pre-send guard відсікає файл без жодного LLM-виклику.
 * @returns {number} бюджет у токенах
 */
function srcTokenBudget() {
  return Math.floor((Number(env.N_CURSOR_DOCGEN_CTX) || DEFAULT_CONTEXT_TOKENS) * 0.5)
}
/**
 * Дефолтна модель: N_CURSOR_DOCGEN_MODEL → resolveModel('min') (→ N_LOCAL_MIN_MODEL).
 * Без хардкод-fallback: модель налаштовує кожен локально (`N_LOCAL_MIN_MODEL`); якщо
 * нічого не задано — порожньо, і preflight оркестратора фейлить гучно (а не шле
 * запит до неіснуючої моделі).
 */
export const DEFAULT_LOCAL_MODEL = env.N_CURSOR_DOCGEN_MODEL ?? resolveModel('min')

/**
 * Фініш unsupported-джерела (vue/py до юніт-шару): скорер не застосовний — score=null,
 * не degraded. Виняток — refusal-пре-гейт: чат-філер замість доки детектується й тут;
 * score=0, щоб degraded-доретрай батчу (score < поріг) підібрав файл наступним прогоном.
 * @param {{ md: string }} r результат oneShotDoc
 * @param {{ t0: number, model: string, chainExtra: object }} genCtx контекст генерації (chainExtra мутується)
 * @returns {object} результат generateDoc для unsupported-файлу
 */
function finishUnsupported(r, { t0, model, chainExtra }) {
  const refusal = detectRefusalFiller(splitProtected(r.md).without)
  chainExtra.degraded = Boolean(refusal)
  return {
    ...r,
    ms: Date.now() - t0,
    llmMs: llmMeter.ms,
    llmCalls: llmMeter.calls,
    score: refusal ? 0 : null,
    issues: refusal ? ['refusal-filler'] : [],
    degraded: Boolean(refusal),
    model
  }
}

/**
 * Головний API: файл → md-дока з det-оцінкою.
 *
 * Local-only (ADR 260610-2228): жодних cloud-ескалацій і pre-route — будь-який
 * файл генерується локальною моделлю. Якщо det-score нижче порогу, один retry
 * з вищою температурою (best-of-2); якщо й він не допоміг — результат
 * позначається `degraded`, рішення про перегенерацію приймає batch/користувач.
 * @param {string} file абсолютний шлях джерела
 * @param {{ model?: string, threshold?: number, existingMd?: string|null, chainFactory?: typeof startChain, deadlineAt?: number|null }} [opts] model-id, поріг degraded, наявна дока (для збереження захищеної секції), фабрика ланцюжка (інжект для тестів), deadlineAt — мʼякий дедлайн fix-pipeline (epoch ms): per-call таймаути ріжуться під залишок бюджету, вичерпаний бюджет обриває генерацію transient-помилкою
 * @returns {{ md: string, ms: number, llmMs: number, llmCalls: number, score: number|null, issues: string[], degraded: boolean, model: string }} документ і метадані генерації (ms — увесь файл; llmMs/llmCalls — лише LLM; решта ms — оркестрація)
 */
export async function generateDoc(
  file,
  {
    model = DEFAULT_LOCAL_MODEL,
    threshold = QUALITY_THRESHOLD,
    existingMd = null,
    chainFactory = startChain,
    deadlineAt = null
  } = {}
) {
  const src = readFileSync(file, 'utf8')
  // Pre-send guard: весь src вшивається у промпт як є (екстракт фактів його НЕ
  // замінює). Для гігантів (vendored/генерат) це переповнює контекст → інстант-skip
  // без LLM-виклику. Маркер «Prompt too long» → classifyOmlxError → permanent → skip.
  // Guard ДО створення ланцюжка: skip без LLM — не задача.
  const estTokens = Math.round(Buffer.byteLength(src, 'utf8') / 4)
  const budget = srcTokenBudget()
  if (estTokens > budget) {
    throw new Error(
      `docgen pre-send guard: джерело ~${estTokens} токенів > бюджет ${budget} (0.5× контексту) — Prompt too long, skip`
    )
  }
  // Факт-лист — лише від мовного екстрактора lang-плагіна (js/mjs/ts —
  // lang-js, `.rs` — lang-rust); без екстрактора для розширення — whole-file
  // шлях через `unsupported` (у ядрі вбудованих екстракторів немає, фаза 5b).
  const langExtractors = await loadDocFilesExtractors(process.cwd())
  const ext = `.${file.split('.').pop()}`.toLowerCase()
  const facts = langExtractors.get(ext)?.extractFacts?.(src, file) ?? {
    relPath: file,
    lang: ext.slice(1),
    unsupported: true,
    header: '',
    exports: [],
    imports: {},
    markers: {}
  }
  const t0 = Date.now()
  llmMeter = { calls: 0, ms: 0 }
  const chain = chainFactory({ kind: 'doc-generate', unit: facts.relPath, cwd: process.cwd() })
  activeChain = chain
  activeDeadlineAt = deadlineAt
  const chainExtra = {}
  try {
    return await generateDocCore()
  } catch (error) {
    chainExtra.error = String(error.message ?? error).slice(0, 200)
    throw error
  } finally {
    activeChain = null
    activeDeadlineAt = null
    let outcome = 'success'
    if (chainExtra.error) outcome = 'fail'
    else if (chainExtra.degraded) outcome = 'partial'
    chain.end({ outcome, extra: chainExtra })
  }

  /**
   * Тіло генерації (замикання над generateDoc-локалами); заповнює chainExtra.
   * @returns {Promise<object>} результат generateDoc
   */
  async function generateDocCore() {
    // Варіант B: захищена секція «Призначення» з наявної доки — зберегти й подати як контекст
    const intent = existingMd ? splitProtected(existingMd).body : null
    const anchors = facts.unsupported ? null : extractAnchors(src)
    const promptSrc = resolvePromptSrc({ facts, estTokens, langExtractors, ext, src, file })
    let r = facts.unsupported
      ? await oneShotDoc(facts, src, model, LOCAL_TIMEOUT_MS, { intent })
      : await orchestratedDoc(facts, promptSrc, model, LOCAL_TIMEOUT_MS, { anchors, intent })

    // unsupported (vue/py до юніт-шару): скорер не застосовний — score=null, не degraded
    // (окрім refusal-пре-гейта — див. finishUnsupported).
    if (facts.unsupported) {
      chainExtra.unsupported = true
      return finishUnsupported(r, { t0, model, chainExtra })
    }

    // Stage 2.5: детермінований скоринг (0 токенів)
    let { score, issues } = scoreDoc(r.md, facts, { anchors, src })

    // E4: best-of-2 — один retry з вищою температурою, det-вибір кращого
    if (score < threshold && env.N_CURSOR_DOCGEN_BEST_OF !== '0') {
      try {
        const r2 = await orchestratedDoc(facts, promptSrc, model, LOCAL_TIMEOUT_MS, {
          anchors,
          temperature: 0.5,
          intent
        })
        const s2 = scoreDoc(r2.md, facts, { anchors, src })
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

    // Stage 3 (опц.): семантичний judge-гейт — лише за N_CURSOR_DOCGEN_JUDGE=1 і на
    // доках, що ПРОЙШЛИ det-скорер (там ховаються false-positives). Scope: inaccurate.
    let judge = null
    if (JUDGE_ENABLED && score >= threshold) {
      ;({ judge, r, score, issues } = await runJudgeGate({ r, score, issues, facts, anchors, src, model, chain }))
    }

    const degraded = score < threshold || judgeFailsDoc(judge)
    chainExtra.score = score
    chainExtra.degraded = degraded
    chainExtra.bestOf2Won = issues.includes('best-of-2:retry-won')
    if (judge) chainExtra.judge = { inaccurate: judgeFailsDoc(judge), confidence: judge.confidence ?? null }
    return {
      ...r,
      ms: Date.now() - t0,
      llmMs: llmMeter.ms,
      llmCalls: llmMeter.calls,
      score,
      issues,
      judge,
      degraded,
      model
    }
  }
}

/**
 * T8 (2b-batch, рішення Р): підготовка ОДНОГО item-у для `submitBatch` — та сама
 * pre-send guard і той самий факт-лист/one-shot messages, що й `oneShotDoc`/
 * `generateDoc`, але БЕЗ виклику LLM (виклик робить batch-шар одним `submit` на
 * всі файли разом). Кидає ту саму помилку pre-send guard, що й `generateDoc`
 * (класифікується `permanent` у batch-оркестраторі — skip, не помилка прогону).
 * @param {string} file абсолютний шлях джерела
 * @param {{ existingMd?: string|null }} [opts] наявна дока (для захищеної секції «Призначення»)
 * @returns {Promise<{ facts: object, anchors: object|null, src: string, messages: Array<{role:string,content:string}>, intent: string|null }>} усе потрібне для item-у batch-у й пізнішого фінішу
 */
export async function prepareBatchItem(file, { existingMd = null } = {}) {
  const src = readFileSync(file, 'utf8')
  const estTokens = Math.round(Buffer.byteLength(src, 'utf8') / 4)
  const budget = srcTokenBudget()
  if (estTokens > budget) {
    throw new Error(
      `docgen pre-send guard: джерело ~${estTokens} токенів > бюджет ${budget} (0.5× контексту) — Prompt too long, skip`
    )
  }
  const langExtractors = await loadDocFilesExtractors(process.cwd())
  const ext = `.${file.split('.').pop()}`.toLowerCase()
  const facts = langExtractors.get(ext)?.extractFacts?.(src, file) ?? {
    relPath: file,
    lang: ext.slice(1),
    unsupported: true,
    header: '',
    exports: [],
    imports: {},
    markers: {}
  }
  const anchors = facts.unsupported ? null : extractAnchors(src)
  const intent = existingMd ? splitProtected(existingMd).body : null
  return { facts, anchors, src, messages: oneShotMessages(facts, src), intent }
}

/**
 * T8 (2b-batch): постобробка ОДНОГО результату `submitBatch` — той самий фініш,
 * що й `oneShotDoc`/`finishUnsupported`/det-скорер, тільки без LLM-виклику
 * (текст уже отримано з batch-у). Judge-гейт (Stage 3) у batch-шляху НЕ
 * викликається (мінімальний обсяг T8 — генерація; judge лишається опційним
 * розширенням послідовного шляху).
 * @param {string} text сирий текст відповіді моделі для цього item-у
 * @param {{ facts: object, anchors: object|null, src: string, intent: string|null, model: string, threshold?: number }} ctx контекст item-у (з `prepareBatchItem`)
 * @returns {{ md: string, score: number|null, issues: string[], degraded: boolean, model: string }} результат генерації для штампу/запису
 */
export function finishBatchItem(text, { facts, anchors, src, intent, model, threshold = QUALITY_THRESHOLD }) {
  let md = stripSignatures(stripSection(text))
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  md = insertProtected(md + '\n', intent)
  if (facts.unsupported) {
    const refusal = detectRefusalFiller(splitProtected(md).without)
    return {
      md,
      score: refusal ? 0 : null,
      issues: refusal ? ['refusal-filler'] : [],
      degraded: Boolean(refusal),
      model
    }
  }
  const { score, issues } = scoreDoc(md, facts, { anchors, src })
  return { md, score, issues, degraded: score < threshold, model }
}

// CLI: node docgen-gen.mjs <file> [--model <m>]
if (isRunAsCli(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  if (!file) {
    throw new Error('Usage: node docgen-gen.mjs <file> [--model <m>]')
  }
  const mi = args.indexOf('--model')
  const model = mi === -1 ? DEFAULT_LOCAL_MODEL : args[mi + 1]
  // Зберегти захищену секцію «Призначення», якщо дока вже існує
  const docPath = docPathForSource(file)
  const existingMd = existsSync(docPath) ? readFileSync(docPath, 'utf8') : null
  const r = await generateDoc(file, { model, existingMd })
  const issuesTxt = r.issues?.length ? ` issues=${r.issues.join(',')}` : ''
  process.stderr.write(
    `[local ${r.model}] ${r.ms}ms (llm ${r.llmMs}ms/${r.llmCalls} calls, orch ${r.ms - r.llmMs}ms) / score=${r.score}${r.degraded ? ' DEGRADED' : ''}${issuesTxt}\n`
  )
  process.stdout.write(r.md)
}
