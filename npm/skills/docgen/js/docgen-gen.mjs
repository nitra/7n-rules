/** @see ./docs/docgen-gen.md */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'
import { LOCAL_MIN, resolveModel } from '../../../lib/models.mjs'
import { extractFacts } from './docgen-extract.mjs'
import { sectionMessages, oneShotMessages, STYLE, oneShotPromptText } from './docgen-prompts.mjs'

/** Strips provider prefix from tier string for direct ollama HTTP (ollama/gemma3:4b → gemma3:4b). */
function localModelId(tier) {
  if (!tier) return 'gemma3:4b'
  const i = tier.indexOf('/')
  return i === -1 ? tier : tier.slice(i + 1)
}

const QUALITY_THRESHOLD = 70

/** Один виклик чату до ollama зі streaming (токени стримуються → socket активний, жодного timeout). */
async function ollamaChat(messages, { model, numPredict = 600 }) {
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    think: false,
    options: { num_ctx: 8192, temperature: 0.2, num_predict: numPredict },
    keep_alive: '15m'
  })
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      res => {
        let text = '',
          genTok = 0,
          buf = ''
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
            } catch {
              /* partial line */
            }
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
    t = t
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim()
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
    if (m) {
      cur = m[1].toLowerCase().replace(/[^а-яіїєґa-z0-9]/gi, '')
      result[cur] = ''
    } else if (cur) result[cur] += line + '\n'
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
  const cacheHit = /кеш/i.test(guarantees) && !/(?:не|без)\s+(?:\S+\s+)?кеш|немає\s+кеш/i.test(guarantees)
  if (!facts.markers?.caches && cacheHit) {
    score -= 20
    issues.push('cache-hallucination')
  }

  // Перевіряємо лише бектік-обгорнуті імена (`sym`) — уникаємо substring false positives
  const hasName = (text, sym) => text.includes('`' + sym + '`')
  for (const sym of facts.internalSymbols ?? []) {
    const inDoc = hasName(guarantees, sym) || hasName(s['огляд'] ?? '', sym) || hasName(s['поведінка'] ?? '', sym)
    if (inDoc) {
      score -= 10
      issues.push(`internal-name:${sym}`)
    }
  }

  return { score: Math.max(0, score), issues }
}

/** Tier 2: виклик через pi (провайдер-нейтрально). model — рядок `provider/model-id`. */
function piOneShot(facts, src, model) {
  const fullPrompt = `${STYLE}\n\n${oneShotPromptText(facts, src)}`
  const modelArgs = model ? ['--model', model] : []
  const r = spawnSync('pi', ['-p', fullPrompt, ...modelArgs, '--no-session', '--mode', 'text', '--no-tools'], {
    encoding: 'utf8',
    timeout: 120_000
  })
  if (r.error) throw new Error(`pi Tier 2 error: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`pi Tier 2 exit ${r.status}: ${r.stderr?.slice(0, 300) ?? ''}`)
  const text = r.stdout?.trim() ?? ''
  let md = stripSignatures(stripSection(text))
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  return { md: md + '\n', genTok: 0 }
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
/** Дефолтна Tier 1 модель: N_CURSOR_DOCGEN_MODEL → LOCAL_MIN → ollama gemma3:4b. */
const DEFAULT_LOCAL_MODEL = localModelId(env.N_CURSOR_DOCGEN_MODEL ?? LOCAL_MIN)
/** Дефолтна Tier 2 модель (provider/model-id для pi): N_CURSOR_DOCGEN_CLOUD_MODEL → resolveModel('avg'). */
const DEFAULT_CLOUD_MODEL = env.N_CURSOR_DOCGEN_CLOUD_MODEL ?? resolveModel('avg')

/** Повертає promise, що відхиляється через `ms` мс з повідомленням про timeout. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`local timeout after ${ms / 1000}s`)), ms))
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
export async function generateDoc(
  file,
  {
    model = DEFAULT_LOCAL_MODEL,
    mode = 'orchestrated',
    cloudModel = DEFAULT_CLOUD_MODEL,
    threshold = QUALITY_THRESHOLD,
    symThreshold = DEFAULT_SYM_THRESHOLD
  } = {}
) {
  const src = readFileSync(file, 'utf8')
  const facts = extractFacts(src, file)
  const t0 = Date.now()

  // Pre-routing: складні файли (sym ≥ symThreshold) → одразу Tier 2, не витрачаємо local-час
  const complexity = facts.internalSymbols?.length ?? 0
  if (complexity >= symThreshold && cloudModel) {
    const r2 = piOneShot(facts, src, cloudModel)
    return {
      ...r2,
      ms: Date.now() - t0,
      score: null,
      issues: [`pre-routed:sym=${complexity}`],
      tier: 2,
      model: cloudModel
    }
  }

  // Tier 1: локальна генерація з timeout 5 хв — при перевищенні одразу Tier 2
  let r
  try {
    const localPromise =
      facts.unsupported || mode === 'oneshot'
        ? generateOneShot(facts, src, model)
        : generateOrchestrated(facts, src, model)
    r = await withTimeout(localPromise, LOCAL_TIMEOUT_MS)
  } catch (e) {
    if (cloudModel) {
      const r2 = piOneShot(facts, src, cloudModel)
      return {
        ...r2,
        ms: Date.now() - t0,
        score: null,
        issues: [`local-timeout: ${e.message}`],
        tier: 2,
        model: cloudModel
      }
    }
    throw e
  }

  // Stage 2.5: детермінований скоринг (0 токенів) — gate перед Tier 2
  const { score: detScore, issues: detIssues } = scoreDoc(r.md, facts)

  if (detScore < threshold && cloudModel) {
    const r2 = piOneShot(facts, src, cloudModel)
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
  const mi = args.indexOf('--model')
  const model = mi >= 0 ? args[mi + 1] : DEFAULT_LOCAL_MODEL
  const si = args.indexOf('--sym-threshold')
  const symThreshold = si >= 0 ? Number(args[si + 1]) : DEFAULT_SYM_THRESHOLD
  if (!file) {
    console.error('Usage: node docgen-gen.mjs <file> [--oneshot] [--model <m>] [--sym-threshold N] [--tier-only]')
    process.exit(1)
  }
  if (tierOnly) {
    const src = readFileSync(file, 'utf8')
    const facts = extractFacts(src, file)
    const sym = facts.internalSymbols?.length ?? 0
    const icon = sym >= symThreshold ? '☁️ ' : '💻'
    const label =
      sym >= symThreshold
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
