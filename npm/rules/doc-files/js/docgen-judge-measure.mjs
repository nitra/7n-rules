#!/usr/bin/env node
/**
 * docgen-judge-measure.mjs — Q4 офлайн-вимірювач (spec 2026-06-14-docgen-judge-design).
 *
 * Міряє false-positive rate детермінованого `scoreDoc`: серед доків, що ПРОЙШЛИ
 * (score ≥ threshold), який % сильна хмарна модель-суддя класифікує як
 * `generic`/`inaccurate`. Це число вирішує, чи будувати рантайм-judge-гейт.
 *
 * Генерація: локальна (N_LOCAL_MIN_MODEL, omlx/* → прямий HTTP) — реальний пайплайн.
 * Суддя: openai-codex/gpt-5.4-mini (сильніша хмара, ніж генератор — інакше вимір беззмістовний).
 * Обидва — через існуючий `../../../lib/llm.mjs callLlm` (маршрутизація за префіксом).
 *
 * Кеш на диску (за хешем контенту) → повторні прогони не регенерують і не пересуджують.
 *
 * Usage:
 *   node docgen-judge-measure.mjs <file1> <file2> ...
 *   MEASURE_CACHE=/tmp/x N_CURSOR_DOCGEN_JUDGE_MODEL=openai-codex/gpt-5.4 node docgen-judge-measure.mjs ...
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { generateDoc } from './docgen-gen.mjs'
import { callLlm } from '../../../lib/llm.mjs'
import { QUALITY_THRESHOLD } from './docgen-crc.mjs'

const env = process.env
const GEN_MODEL = env.N_LOCAL_MIN_MODEL ?? 'omlx/gemma-4-e4b-it-OptiQ-4bit'
const JUDGE_MODEL = env.N_CURSOR_DOCGEN_JUDGE_MODEL ?? 'openai-codex/gpt-5.4-mini'
const THRESHOLD = Number(env.N_CURSOR_DOC_FILES_THRESHOLD ?? QUALITY_THRESHOLD) || 70
const CACHE_DIR = env.MEASURE_CACHE ?? '/tmp/docgen-judge-measure'
const JUDGE_TIMEOUT = Number(env.MEASURE_JUDGE_TIMEOUT_MS ?? 120_000)

const SYSTEM = `You are a strict technical-documentation reviewer. You receive a SOURCE file and an auto-generated Markdown DOC describing it. Classify the DOC into exactly one verdict:
- "accurate": specific to THIS file AND every factual claim is supported by the source.
- "generic": could describe almost any file of this kind; vague/boilerplate; lacks file-specific substance.
- "inaccurate": contains at least one claim that is NOT supported by, or is contradicted by, the source code.
Prefer "inaccurate" over "generic" if any claim is wrong. Respond with ONLY a JSON object, no prose:
{"verdict":"accurate|generic|inaccurate","confidence":0.0-1.0,"reason":"<20-300 chars>","offending":["<short quote from doc>"]}`

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

function cacheGet(key) {
  const p = join(CACHE_DIR, key + '.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
function cacheSet(key, val) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(join(CACHE_DIR, key + '.json'), JSON.stringify(val))
}

/** Генерує (з кешем за хешем src). */
function genCached(file, src) {
  const key = 'gen-' + sha(GEN_MODEL + '\0' + src)
  const hit = cacheGet(key)
  if (hit) return { ...hit, cached: true }
  const r = generateDoc(file, { model: GEN_MODEL })
  const out = { md: r.md, score: r.score, issues: r.issues, degraded: r.degraded }
  cacheSet(key, out)
  return { ...out, cached: false }
}

/** Судить (з кешем за хешем src+doc). */
function judgeCached(src, doc) {
  const key = 'judge-' + sha(JUDGE_MODEL + '\0' + src + '\0' + doc)
  const hit = cacheGet(key)
  if (hit) return { ...hit, cached: true }
  const user = `SOURCE FILE:\n\`\`\`\n${src.slice(0, 12000)}\n\`\`\`\n\nGENERATED DOC:\n\`\`\`md\n${doc.slice(0, 8000)}\n\`\`\`\n\nReturn the JSON verdict.`
  const raw = callLlm([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], JUDGE_MODEL, { timeoutMs: JUDGE_TIMEOUT, temperature: 0 })
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
  if (a < 0 || b < 0) throw new Error('no JSON in judge reply: ' + raw.slice(0, 160))
  const v = JSON.parse(raw.slice(a, b + 1))
  cacheSet(key, v)
  return { ...v, cached: false }
}

function main() {
  const files = process.argv.slice(2).filter(f => !f.startsWith('--'))
  if (!files.length) {
    console.error('Usage: node docgen-judge-measure.mjs <file1> <file2> ...')
    process.exit(2)
  }
  console.error(`[measure] gen=${GEN_MODEL} judge=${JUDGE_MODEL} threshold=${THRESHOLD} files=${files.length} cache=${CACHE_DIR}`)

  const rows = []
  for (const [i, file] of files.entries()) {
    const tag = `(${i + 1}/${files.length}) ${file}`
    let src
    try { src = readFileSync(file, 'utf8') } catch (e) { console.error(`[skip] ${tag}: read ${e.message}`); continue }

    let gen
    try { gen = genCached(file, src) } catch (e) { console.error(`[gen-err] ${tag}: ${e.message.slice(0, 120)}`); rows.push({ file, error: 'gen', detail: e.message.slice(0, 200) }); continue }
    if (gen.score == null) { console.error(`[unsupported] ${tag}`); rows.push({ file, score: null, unsupported: true }); continue }

    const passed = gen.score >= THRESHOLD
    const row = { file, score: gen.score, degraded: gen.degraded, passed, genCached: gen.cached }
    console.error(`[gen${gen.cached ? '*' : ''}] ${tag} score=${gen.score} ${passed ? 'PASS' : 'degraded'}`)

    if (passed) {
      try {
        const v = judgeCached(src, gen.md)
        row.verdict = v.verdict; row.confidence = v.confidence; row.reason = v.reason; row.offending = v.offending; row.judgeCached = v.cached
        console.error(`  [judge${v.cached ? '*' : ''}] ${v.verdict} (${v.confidence}) — ${(v.reason || '').slice(0, 90)}`)
      } catch (e) { row.judgeError = e.message.slice(0, 200); console.error(`  [judge-err] ${e.message.slice(0, 120)}`) }
    }
    rows.push(row)
  }

  // Aggregate
  const scored = rows.filter(r => typeof r.score === 'number')
  const passedRows = scored.filter(r => r.passed && r.verdict)
  const byVerdict = { accurate: 0, generic: 0, inaccurate: 0 }
  for (const r of passedRows) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1
  const M = passedRows.length
  const bad = byVerdict.generic + byVerdict.inaccurate
  const pct = n => (M ? ((100 * n) / M).toFixed(1) : '—')

  const report = {
    config: { genModel: GEN_MODEL, judgeModel: JUDGE_MODEL, threshold: THRESHOLD },
    counts: {
      files: files.length, generated: scored.length,
      unsupported: rows.filter(r => r.unsupported).length,
      genErrors: rows.filter(r => r.error === 'gen').length,
      passedDetScorer: scored.filter(r => r.passed).length,
      judged: M, judgeErrors: rows.filter(r => r.judgeError).length
    },
    falsePositiveRate: { // серед PASSED+judged
      accurate: byVerdict.accurate, generic: byVerdict.generic, inaccurate: byVerdict.inaccurate,
      badPct: pct(bad), inaccuratePct: pct(byVerdict.inaccurate), genericPct: pct(byVerdict.generic)
    },
    offenders: passedRows.filter(r => r.verdict !== 'accurate').map(r => ({ file: r.file, score: r.score, verdict: r.verdict, confidence: r.confidence, reason: r.reason })),
    rows
  }

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  const out = join(CACHE_DIR, 'report.json')
  writeFileSync(out, JSON.stringify(report, null, 2))

  console.log('\n===== Q4 MEASUREMENT =====')
  console.log(`generated: ${report.counts.generated}/${files.length}  (unsupported=${report.counts.unsupported}, gen-errors=${report.counts.genErrors})`)
  console.log(`passed det-scorer (score≥${THRESHOLD}): ${report.counts.passedDetScorer}   judged: ${M}`)
  console.log(`among PASSED+judged → accurate=${byVerdict.accurate} generic=${byVerdict.generic} inaccurate=${byVerdict.inaccurate}`)
  console.log(`>>> det-scorer FALSE-POSITIVE rate: ${pct(bad)}%  (inaccurate=${pct(byVerdict.inaccurate)}%, generic=${pct(byVerdict.generic)}%)`)
  console.log(`decision guide: <~5% → don't build gate; >~15% → build (inaccurate-only)`)
  console.log(`report: ${out}`)
}

main()
