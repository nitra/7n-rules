/** @see ./docs/docgen-gen.md */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'
import { resolveModel } from '../../../lib/models.mjs'
import { extractFacts } from './docgen-extract.mjs'
import { extractAnchors } from './docgen-extract-anchors.mjs'
import { oneShotMessages, sectionMessages, criticMessages, refineMessages, guaranteesFromMarkers } from './docgen-prompts.mjs'

const QUALITY_THRESHOLD = 70

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
  for (let i = 0; i < 2; i++) t = t.replaceAll(/([`\w$.]+)\([^()]*\)/g, '$1')
  return t
}

/** Розбиває md на секції за ## заголовками → { огляд, поведінка, api, гарантіїповедінки, … } */
function parseSections(md) {
  const result = {}
  let cur = null
  for (const line of md.split('\n')) {
    const m = line.match(/^##\s+(.+)/)
    if (m) {
      cur = m[1].toLowerCase().replaceAll(/[^а-яіїєґa-z0-9]/gi, '')
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

/**
 * omlx-бекенд: справжні OpenAI-сумісні messages (system+user збереженi).
 * Вмикається `N_CURSOR_DOCGEN_BACKEND=omlx`.
 * URL: `N_CURSOR_DOCGEN_OMLX_URL` або http://127.0.0.1:8000/v1/chat/completions.
 * Модель: переданий `model`, потім `N_CURSOR_DOCGEN_OMLX_MODEL`, потім дефолт.
 */
function callOmlxMessages(messages, model, timeoutMs, temperature = 0.2) {
  const url = env.N_CURSOR_DOCGEN_OMLX_URL ?? 'http://127.0.0.1:8000/v1/chat/completions'
  const m = model || env.N_CURSOR_DOCGEN_OMLX_MODEL || 'mlx-community--gemma-4-e2b-it-4bit'
  const body = JSON.stringify({
    model: m,
    messages,
    max_tokens: 4096,
    temperature
  })
  // Ретраїмо лише transient curl-помилки (18 = transfer closed, 56 = recv failure, 52 = empty reply).
  const TRANSIENT_CURL_CODES = new Set([18, 52, 56])
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync(
      'curl',
      ['-sS', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-H', 'Connection: close', '--max-time', String(Math.ceil(timeoutMs / 1000)), '--data-binary', '@-'],
      { input: body, encoding: 'utf8', timeout: timeoutMs + 5000 }
    )
    if (r.error) {
      lastErr = new Error(`omlx curl error: ${r.error.message}`)
      break
    }
    if (r.status !== 0) {
      if (TRANSIENT_CURL_CODES.has(r.status) && attempt < 3) {
        lastErr = new Error(`omlx curl exit ${r.status} (transient, retry ${attempt})`)
        continue
      }
      throw new Error(`omlx curl exit ${r.status}: ${r.stderr?.slice(0, 300) ?? ''}`)
    }
    let j
    try { j = JSON.parse(r.stdout) } catch { throw new Error(`omlx bad json: ${r.stdout?.slice(0, 200) ?? ''}`) }
    if (j.error) throw new Error(`omlx api: ${JSON.stringify(j.error).slice(0, 300)}`)
    const content = j.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) {
      const finish = j.choices?.[0]?.finish_reason
      throw new Error(`omlx empty content (finish=${finish})`)
    }
    return content
  }
  throw lastErr ?? new Error('omlx unknown failure')
}

/**
 * Універсальний виклик LLM за повним messages-масивом.
 * - omlx: шле messages напряму (system збережено)
 * - pi: конкатенує message.content (pi приймає лише plain prompt)
 */
function callLlm(messages, model, timeoutMs, temperature = 0.2) {
  if (env.N_CURSOR_DOCGEN_BACKEND === 'omlx') return callOmlxMessages(messages, model, timeoutMs, temperature)
  const prompt = messages.map(m => m.content).join('\n\n')
  const modelArgs = model ? ['--model', model] : []
  const r = spawnSync('pi', ['-p', prompt, ...modelArgs, '--no-session', '--mode', 'text', '--no-tools'], {
    encoding: 'utf8',
    timeout: timeoutMs
  })
  if (r.error) throw new Error(`pi error: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`pi exit ${r.status}: ${r.stderr?.slice(0, 300) ?? ''}`)
  return r.stdout?.trim() ?? ''
}

/**
 * E2 — один цикл critique→refine на секцію.
 * Повертає або уточнену чорнетку, або оригінал якщо критик повідомив NONE.
 */
function critiqueRefineSection(sectionKey, draft, facts, anchors, model, timeoutMs) {
  const critique = callLlm(criticMessages(sectionKey, draft, facts, anchors), model, timeoutMs).trim()
  if (!critique || /^\s*NONE\s*$/i.test(critique) || critique.length < 12) return draft
  const refined = callLlm(refineMessages(sectionKey, draft, critique, facts, anchors), model, timeoutMs).trim()
  return stripSignatures(stripSection(refined)) || draft
}

/**
 * Чи треба refine для секції API: тільки якщо є >1 експорту і всі desc-и порожні
 * (саме там модель схильна писати «застосовує логіку до файлу»).
 */
function apiNeedsRefine(facts) {
  const exps = facts.exports ?? []
  if (exps.length <= 1) return false
  return exps.every(e => !e.desc)
}

/** One-shot: один виклик LLM на весь документ. */
function piOneShot(facts, src, model, timeoutMs = 120_000) {
  const text = callLlm(oneShotMessages(facts, src), model, timeoutMs)
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

/**
 * Orchestrated: N окремих pi-викликів, по одному на секцію.
 * Код потрапляє лише в `behavior`; решта секцій — на мінімальному факт-листі.
 */
function piOrchestrated(facts, src, model, timeoutMs, { anchors = null, temperature = 0.2 } = {}) {
  const sections = {}
  const anc = anchors ?? extractAnchors(src)
  // E3: «Гарантії» — детермінований шаблон з markers (0 LLM-запитів, 0 generic-фраз)
  sections.guarantees = guaranteesFromMarkers(facts)
  for (const s of sectionMessages(facts, src, anc)) {
    if (s.key === 'guarantees') continue // вже згенеровано детерміновано
    let draft = stripSignatures(stripSection(callLlm(s.messages, model, timeoutMs, temperature)))
    // E2 + E3: critique→refine лише для секцій, де gemma-4 зриває на generic
    if (s.key === 'overview' || (s.key === 'api' && apiNeedsRefine(facts))) {
      draft = critiqueRefineSection(s.key, draft, facts, anc, model, timeoutMs)
    }
    sections[s.key] = draft
  }
  return { md: assemble(basename(facts.relPath), sections), genTok: 0 }
}



/** Файли з sym ≥ цього значення одразу йдуть у Tier 2 (без Tier 1 проходу). */
const DEFAULT_SYM_THRESHOLD = 4
/** Максимальний час Tier 1 генерації на один файл перед ескалацією у Tier 2. */
const LOCAL_TIMEOUT_MS = 5 * 60 * 1000
/** Дефолтна Tier 1 модель: N_CURSOR_DOCGEN_MODEL → resolveModel('min'). */
const DEFAULT_LOCAL_MODEL = env.N_CURSOR_DOCGEN_MODEL ?? resolveModel('min')
/** Дефолтна Tier 2 модель: N_CURSOR_DOCGEN_CLOUD_MODEL → resolveModel('avg'). */
const DEFAULT_CLOUD_MODEL = env.N_CURSOR_DOCGEN_CLOUD_MODEL ?? resolveModel('avg')

/**
 * Головний API: файл → { md, genTok, ms, score, issues, tier }.
 *
 * Routing (sym-threshold):
 *   sym < symThreshold  → Tier 1 pi(resolveModel('min'), timeout=5хв) + det-scorer
 *                       → timeout або det-score < threshold → Tier 2
 *   sym >= symThreshold → Pre-routing одразу Tier 2
 */
export async function generateDoc(
  file,
  {
    model = DEFAULT_LOCAL_MODEL,
    cloudModel = DEFAULT_CLOUD_MODEL,
    threshold = QUALITY_THRESHOLD,
    symThreshold = DEFAULT_SYM_THRESHOLD
  } = {}
) {
  const src = readFileSync(file, 'utf8')
  const facts = extractFacts(src, file)
  const t0 = Date.now()

  // Pre-routing: складні файли (sym ≥ symThreshold) → одразу Tier 2
  const complexity = facts.internalSymbols?.length ?? 0
  if (complexity >= symThreshold && cloudModel) {
    const r2 = piOneShot(facts, src, cloudModel)
    return { ...r2, ms: Date.now() - t0, score: null, issues: [`pre-routed:sym=${complexity}`], tier: 2, model: cloudModel }
  }

  // Tier 1: pi orchestrated (секція за секцією), timeout на секцію = LOCAL_TIMEOUT_MS
  // facts.unsupported → one-shot (структура файлу нестандартна)
  let r
  const anchors = facts.unsupported ? null : extractAnchors(src)
  try {
    r = facts.unsupported
      ? piOneShot(facts, src, model, LOCAL_TIMEOUT_MS)
      : piOrchestrated(facts, src, model, LOCAL_TIMEOUT_MS, { anchors })
  } catch (error) {
    if (cloudModel) {
      const r2 = piOneShot(facts, src, cloudModel)
      return { ...r2, ms: Date.now() - t0, score: null, issues: [`tier1-error: ${error.message}`], tier: 2, model: cloudModel }
    }
    throw error
  }

  // Stage 2.5: детермінований скоринг (0 токенів) — gate перед Tier 2
  let { score: detScore, issues: detIssues } = scoreDoc(r.md, facts)

  // E4: best-of-N. Якщо score нижчий за threshold і немає cloud-fallback — спроба
  // ще раз з вищою температурою, керуємо через env (повторні прогони коштовні).
  if (detScore < threshold && !cloudModel && !facts.unsupported && env.N_CURSOR_DOCGEN_BEST_OF !== '0') {
    try {
      const r2 = piOrchestrated(facts, src, model, LOCAL_TIMEOUT_MS, { anchors, temperature: 0.5 })
      const s2 = scoreDoc(r2.md, facts)
      if (s2.score > detScore) {
        r = r2
        detScore = s2.score
        detIssues = [...s2.issues, 'best-of-2:retry-won']
      } else {
        detIssues = [...detIssues, 'best-of-2:retry-lost']
      }
    } catch (error) {
      detIssues = [...detIssues, `best-of-2:retry-error: ${error.message}`]
    }
  }

  if (detScore < threshold && cloudModel) {
    const r2 = piOneShot(facts, src, cloudModel)
    return { ...r2, ms: Date.now() - t0, score: detScore, issues: detIssues, tier: 2, model: cloudModel }
  }

  return { ...r, ms: Date.now() - t0, score: detScore, issues: detIssues, tier: 1, model }
}

// CLI: node docgen-gen.mjs <file> [--model <m>] [--sym-threshold N] [--tier-only]
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
if (isRunAsCli(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  const tierOnly = args.includes('--tier-only')
  const mi = args.indexOf('--model')
  const model = mi !== -1 ? args[mi + 1] : DEFAULT_LOCAL_MODEL
  const si = args.indexOf('--sym-threshold')
  const symThreshold = si !== -1 ? Number(args[si + 1]) : DEFAULT_SYM_THRESHOLD
  if (!file) {
    console.error('Usage: node docgen-gen.mjs <file> [--model <m>] [--sym-threshold N] [--tier-only]')
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
  const r = await generateDoc(file, { model, symThreshold })
  const issuesTxt = r.issues?.length ? ` issues=${r.issues.join(',')}` : ''
  process.stderr.write(`[tier${r.tier} pi-orchestrated] ${r.ms}ms / score=${r.score}${issuesTxt}\n`)
  process.stdout.write(r.md)
}
