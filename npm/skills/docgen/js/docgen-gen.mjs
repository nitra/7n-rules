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

/** Tier 2: хмарний fallback через Claude коли local-score < QUALITY_THRESHOLD. */
async function claudeOneShot(facts, src, model = 'claude-haiku-4-5') {
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

/**
 * Головний API: файл → { md, genTok, ms, score, issues, tier }.
 * Tier 1 = local ollama; Tier 2 = хмарний Claude (якщо score < QUALITY_THRESHOLD).
 * @param {string} cloudModel — Claude-модель для Tier 2 (default claude-haiku-4-5).
 */
export async function generateDoc(file, {
  model = 'gemma3:4b',
  mode = 'orchestrated',
  cloudModel = 'claude-haiku-4-5',
  threshold = QUALITY_THRESHOLD
} = {}) {
  const src = readFileSync(file, 'utf8')
  const facts = extractFacts(src, file)
  const t0 = Date.now()

  let r = facts.unsupported
    ? await generateOneShot(facts, src, model)
    : mode === 'oneshot'
      ? await generateOneShot(facts, src, model)
      : await generateOrchestrated(facts, src, model)

  const { score, issues } = scoreDoc(r.md, facts)

  if (score < threshold && env.ANTHROPIC_API_KEY) {
    const r2 = await claudeOneShot(facts, src, cloudModel)
    return { ...r2, ms: Date.now() - t0, score, issues, tier: 2 }
  }

  return { ...r, ms: Date.now() - t0, score, issues, tier: 1 }
}

// CLI: node docgen-gen.mjs <file> [--oneshot] [--model <m>]
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
if (isRunAsCli(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  const mode = args.includes('--oneshot') ? 'oneshot' : 'orchestrated'
  const mi = args.indexOf('--model'); const model = mi >= 0 ? args[mi + 1] : 'gemma3:4b'
  if (!file) { console.error('Usage: node docgen-gen.mjs <file> [--oneshot] [--model <m>]'); process.exit(1) }
  const r = await generateDoc(file, { model, mode })
  const issuesTxt = r.issues?.length ? ` issues=${r.issues.join(',')}` : ''
  process.stderr.write(`[tier${r.tier} ${mode}] ${r.ms}ms / ${r.genTok} tok / score=${r.score}${issuesTxt}\n`)
  process.stdout.write(r.md)
}
