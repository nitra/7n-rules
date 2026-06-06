/**
 * docgen-конвеєр (входна точка): код файлу → .md-документація.
 *
 * Інверсія керування: веде цей JS, а локальна модель — лише сервіс перефразування.
 *   Stage 0  extractFacts        — факти з коду (0 токенів)
 *   Stage 1  sectionInstructions — точкові промпти на кожну секцію (спільний KV-cached префікс)
 *   Stage 2  stripSignatures     — детермінований зріз сигнатур (0 токенів)
 *   Stage 2.5 scoreDoc           — детермінований скоринг проти фактів (0 токенів)
 *   Stage 3  assemble            — фіксовані заголовки/порядок + зрізання fence
 *   Tier 2   claudeOneShot       — хмарний fallback якщо score < QUALITY_THRESHOLD
 *
 * Hybrid routing (sym-threshold):
 *   sym < DEFAULT_SYM_THRESHOLD → Tier 1 local + det-scorer (0 токенів)
 *                                → timeout > LOCAL_TIMEOUT_MS або score < QUALITY_THRESHOLD → Tier 2
 *   sym >= DEFAULT_SYM_THRESHOLD → одразу Tier 2 (pre-routing, без local)
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { request } from 'node:http'
import { env } from 'node:process'
import Anthropic from '@anthropic-ai/sdk'
import { extractFacts } from './docgen-extract.mjs'
import { sectionMessages, oneShotMessages, STYLE, oneShotPromptText } from './docgen-prompts.mjs'

const QUALITY_THRESHOLD = 70

/** Один виклик чату до ollama зі streaming (токени стримуються → socket активний, жодного timeout). */
async function ollamaChat(messages, { model, numPredict = 600 }) {
  const body = JSON.stringify({
    model, messages, stream: true, think: false,
    options: { num_ctx: 8192, temperature: 0.2, num_predict: numPredict },
    keep_alive: '15m'
  })
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'localhost', port: 11434, path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let text = '', genTok = 0, buf = ''
        res.on('data', chunk => {
          buf += chunk.toString()
          const lines = buf.split('\n')
          buf = lines.pop()
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const j = JSON.parse(line)
              text += j.message?.content ?? ''
              if (j.done) genTok = j.eval_count ?? 0
            } catch { /* partial line */ }
          }
        })
        res.on('end', () => resolve({ text, genTok }))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** Прибирає ```-обгортку й випадковий провідний `##`-заголовок із секції. */
function stripSection(text) {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '').trim()
  }
  t = t.replace(/^#{1,6}\s+.*\n+/, '') // зрізати випадковий заголовок
  return t.trim()
}

/**
 * Stage 2 (детермінований лінт, 0 токенів): зрізає сигнатури `name(args)` → `name`.
 * Два проходи — щоб зняти вкладені виклики на кшталт `check(cwd = process.cwd())`.
 * Не чіпає дужки без ідентифікатора перед ними (напр. `(abie.mdc)`, «(наприклад)»).
 */
function stripSignatures(text) {
  let t = text
  for (let i = 0; i < 2; i++) t = t.replace(/([`\w$.]+)\([^()]*\)/g, '$1')
  return t
}

/** Розбиває md на секції за ## заголовками → { огляд, поведінка, api, гарантіїповедінки, … } */
function parseSections(md) {
  const result = {}
  let cur = null
  for (const line of md.split('\n')) {
    const m = line.match(/^##\s+(.+)/)
    if (m) { cur = m[1].toLowerCase().replace(/[^а-яіїєґa-z0-9]/gi, ''); result[cur] = '' }
    else if (cur) result[cur] += line + '\n'
  }
  return result
}

/**
 * Stage 2.5 — детермінований скоринг (0 токенів): перевіряє вихід проти фактів.
 * @returns {{ score: number, issues: string[] }}
 */
function scoreDoc(md, facts) {
  const s = parseSections(md)
  let score = 100
  const issues = []

  if (!s['огляд'])
    { score -= 25; issues.push('no-overview') }

  const behavior = s['поведінка'] ?? ''
  if (behavior.length < 60)
    { score -= 20; issues.push('short-behavior') }

  const guarantees = s['гарантіїповедінки'] ?? ''
  // Будь-яка згадка "кеш" у Гарантіях коли файл не кешує — галюцинація
  // Негація: "не кешує", "не має кешування", "без кешування", "немає кешу"
  const cacheHit = /кеш/i.test(guarantees) && !/(?:не|без)\s+(?:\S+\s+)?кеш|немає\s+кеш/i.test(guarantees)
  if (!facts.markers?.caches && cacheHit)
    { score -= 20; issues.push('cache-hallucination') }

  // Перевіряємо лише бектік-обгорнуті імена (`sym`) — уникаємо substring false positives
  const hasName = (text, sym) => text.includes('`' + sym + '`')
  for (const sym of facts.internalSymbols ?? []) {
    const inDoc = hasName(guarantees, sym) || hasName(s['огляд'] ?? '', sym) || hasName(s['поведінка'] ?? '', sym)
    if (inDoc) { score -= 10; issues.push(`internal-name:${sym}`) }
  }

  return { score: Math.max(0, score), issues }
}

const SCORE_RUBRIC = `Оціни якість документації для JavaScript-модуля за 4 критеріями (1-3 кожен):

- огляд: 3=описує роль модуля в системі (ЩО і НАВІЩО); 2=частково розмитий; 1=відсутній або перераховує функції
- поведінка: 3=бізнес-терміни, без деталей реалізації; 2=деякі impl-деталі; 1=переважно реалізація або відсутня
- гарантії: 3=лише реальні інваріанти підтверджені кодом, без галюцинацій; 2=частково правильні; 1=вигадані або відсутні
- стиль: 3=без сигнатур/internal-імен, правильна markdown-структура; 2=дрібні порушення; 1=сигнатури/internal-імена/відсутні заголовки

Відповідай ТІЛЬКИ JSON без пояснень:
{"огляд":N,"поведінка":N,"гарантії":N,"стиль":N,"issues":["коротко про кожен мінус 1-5 слів"]}`

/**
 * Stage 2.5 cloud: Claude Haiku оцінює якість доку проти коду + фактів.
 * Використовує найдешевшу хмарну модель — haiku — для мінімальної вартості судді.
 * @returns {{ score: number, scores: object, issues: string[], tok: number }}
 */
async function cloudScoreDoc(md, facts, src, model = 'claude-haiku-4-5-20251001') {
  const client = new Anthropic()
  const factsTxt = [
    facts.exports?.length ? `Публічні функції: ${facts.exports.map(e => e.name).join(', ')}` : '',
    facts.internalSymbols?.length ? `Внутрішні (не публічні): ${facts.internalSymbols.join(', ')}` : '',
    facts.markers?.caches ? 'Кешування: є' : 'Кешування: немає',
    facts.markers?.network ? 'Мережа: є' : 'Мережа: немає',
    facts.markers?.readOnly ? 'Read-only (не змінює файли/стан)' : ''
  ].filter(Boolean).join('\n')

  const msg = await client.messages.create({
    model,
    max_tokens: 256,
    system: SCORE_RUBRIC,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `ФАКТИ:\n${factsTxt}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `КОД:\n\`\`\`\n${src.slice(0, 4000)}\n\`\`\``, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `ДОКУМЕНТАЦІЯ:\n${md}` }
      ]
    }]
  })
  const tok = (msg.usage?.input_tokens ?? 0) + (msg.usage?.output_tokens ?? 0)
  try {
    const j = JSON.parse(msg.content[0]?.text ?? '{}')
    const total = ((j.огляд ?? 0) + (j.поведінка ?? 0) + (j.гарантії ?? 0) + (j.стиль ?? 0)) / 12 * 100
    return { score: Math.round(total), scores: j, issues: j.issues ?? [], tok }
  } catch {
    return { score: 50, scores: {}, issues: ['parse-error'], tok }
  }
}

/** Tier 2: хмарний fallback через Claude коли local-score < QUALITY_THRESHOLD. */
async function claudeOneShot(facts, src, model = 'claude-sonnet-4-6') {
  const client = new Anthropic()
  const prompt = oneShotPromptText(facts, src)
  const msg = await client.messages.create({
    model,
    max_tokens: 1500,
    system: STYLE,
    messages: [{ role: 'user', content: prompt }]
  })
  const text = msg.content[0]?.text ?? ''
  const genTok = msg.usage?.output_tokens ?? 0
  let md = stripSignatures(stripSection(text))
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  return { md: md + '\n', genTok }
}

/** Stage 3: фіксовані заголовки у фіксованому порядку. */
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

/** Оркестрований режим: секційно-мінімальний контекст — код інгестується лише в `behavior`. */
async function generateOrchestrated(facts, src, model) {
  const sections = {}
  let genTok = 0
  for (const s of sectionMessages(facts, src)) {
    const { text, genTok: g } = await ollamaChat(s.messages, { model, numPredict: s.numPredict })
    sections[s.key] = stripSignatures(stripSection(text))
    genTok += g
  }
  return { md: assemble(basename(facts.relPath), sections), genTok }
}

/** One-shot режим: один промпт на весь документ. */
async function generateOneShot(facts, src, model) {
  const { text, genTok } = await ollamaChat(oneShotMessages(facts, src), { model, numPredict: 1500 })
  let md = stripSignatures(stripSection(text)) // Stage-2 лінт і для one-shot
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  return { md: md + '\n', genTok }
}

/** Файли з sym ≥ цього значення одразу йдуть у Tier 2 (без локального проходу). */
const DEFAULT_SYM_THRESHOLD = 4
/** Максимальний час локальної генерації на один файл перед ескалацією у Tier 2. */
const LOCAL_TIMEOUT_MS = 5 * 60 * 1000

/** Повертає promise, що відхиляється через `ms` мс з повідомленням про timeout. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`local timeout after ${ms / 1000}s`)), ms)
    )
  ])
}

/**
 * Головний API: файл → { md, genTok, ms, score, issues, tier }.
 *
 * Routing (sym-threshold):
 *   sym < symThreshold  → Tier 1 local (timeout: LOCAL_TIMEOUT_MS) + det-scorer
 *                       → timeout або det-score < threshold → Tier 2
 *   sym >= symThreshold → Pre-routing одразу Tier 2
 *
 * @param {string}  cloudModel    — модель для Tier 2 генерації (Sonnet за замовч.)
 */
export async function generateDoc(file, {
  model = 'gemma3:4b',
  mode = 'orchestrated',
  cloudModel = 'claude-sonnet-4-6',
  threshold = QUALITY_THRESHOLD,
  symThreshold = DEFAULT_SYM_THRESHOLD
} = {}) {
  const src = readFileSync(file, 'utf8')
  const facts = extractFacts(src, file)
  const t0 = Date.now()

  // Pre-routing: складні файли (sym ≥ symThreshold) → одразу Tier 2, не витрачаємо local-час
  const complexity = facts.internalSymbols?.length ?? 0
  if (complexity >= symThreshold && env.ANTHROPIC_API_KEY) {
    const r2 = await claudeOneShot(facts, src, cloudModel)
    return { ...r2, ms: Date.now() - t0, score: null, issues: [`pre-routed:sym=${complexity}`], tier: 2, model: cloudModel }
  }

  // Tier 1: локальна генерація з timeout 5 хв — при перевищенні одразу Tier 2
  let r
  try {
    const localPromise = facts.unsupported || mode === 'oneshot'
      ? generateOneShot(facts, src, model)
      : generateOrchestrated(facts, src, model)
    r = await withTimeout(localPromise, LOCAL_TIMEOUT_MS)
  } catch (e) {
    if (env.ANTHROPIC_API_KEY) {
      const r2 = await claudeOneShot(facts, src, cloudModel)
      return { ...r2, ms: Date.now() - t0, score: null, issues: [`local-timeout: ${e.message}`], tier: 2, model: cloudModel }
    }
    throw e
  }

  // Stage 2.5: детермінований скоринг (0 токенів) — gate перед Tier 2
  const { score: detScore, issues: detIssues } = scoreDoc(r.md, facts)

  if (detScore < threshold && env.ANTHROPIC_API_KEY) {
    const r2 = await claudeOneShot(facts, src, cloudModel)
    return { ...r2, ms: Date.now() - t0, score: detScore, issues: detIssues, tier: 2, model: cloudModel }
  }

  return { ...r, ms: Date.now() - t0, score: detScore, issues: detIssues, tier: 1, model }
}

// CLI: node docgen-gen.mjs <file> [--oneshot] [--model <m>] [--sym-threshold N] [--tier-only]
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
if (isRunAsCli(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  const mode = args.includes('--oneshot') ? 'oneshot' : 'orchestrated'
  const tierOnly = args.includes('--tier-only')
  const mi = args.indexOf('--model'); const model = mi >= 0 ? args[mi + 1] : 'gemma3:4b'
  const si = args.indexOf('--sym-threshold'); const symThreshold = si >= 0 ? Number(args[si + 1]) : DEFAULT_SYM_THRESHOLD
  if (!file) {
    console.error('Usage: node docgen-gen.mjs <file> [--oneshot] [--model <m>] [--sym-threshold N] [--tier-only]')
    process.exit(1)
  }
  if (tierOnly) {
    const src = readFileSync(file, 'utf8')
    const facts = extractFacts(src, file)
    const sym = facts.internalSymbols?.length ?? 0
    const icon = sym >= symThreshold ? '☁️ ' : '💻'
    const label = sym >= symThreshold
      ? `Tier 2 cloud   (sym=${sym} ≥ ${symThreshold}, pre-routed)`
      : `Tier 1 local   (sym=${sym} < ${symThreshold})`
    process.stdout.write(`${icon} ${label}  |  ${file}\n`)
    process.exit(0)
  }
  const r = await generateDoc(file, { model, mode, symThreshold })
  const issuesTxt = r.issues?.length ? ` issues=${r.issues.join(',')}` : ''
  process.stderr.write(`[tier${r.tier} ${mode}] ${r.ms}ms / ${r.genTok} tok / score=${r.score}${issuesTxt}\n`)
  process.stdout.write(r.md)
}
