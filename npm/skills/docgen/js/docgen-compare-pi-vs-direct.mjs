/**
 * A/B: docgen Tier 1 через pi cli (з omlx-провайдером у ~/.pi/agent/models.json)
 * vs прямий callOmlxMessages (`N_CURSOR_DOCGEN_BACKEND=omlx`).
 *
 * Однаковий 8-сет файлів, однаковий оркестратор (E1+E2+E3+E4), різний backend.
 * Пише в /tmp/docgen-compare/{pi,direct}/<idx>-<stem>.md і збирає метрики.
 *
 * Запуск: node npm/skills/docgen/js/docgen-compare-pi-vs-direct.mjs [--from N] [--limit N]
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { env } from 'node:process'
import { generateDoc } from './docgen-gen.mjs'
import { extractFacts } from './docgen-extract.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..')
const TMP = '/tmp/docgen-compare'

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 8
const fromIdx = args.indexOf('--from')
const from = fromIdx !== -1 ? Number(args[fromIdx + 1]) : 1

const scanOut = execSync('node npm/bin/n-cursor.js docgen scan', { cwd: ROOT, encoding: 'utf8' })
const all = JSON.parse(scanOut)

const local = []
for (const f of all) {
  try {
    const src = readFileSync(join(ROOT, f.sourcePath), 'utf8')
    const facts = extractFacts(src, join(ROOT, f.sourcePath))
    const sym = (facts.internalSymbols ?? []).length
    if (sym < 4) local.push({ ...f, sym })
  } catch {}
}
const slice = local.slice(from, from + limit)

mkdirSync(join(TMP, 'pi'), { recursive: true })
mkdirSync(join(TMP, 'direct'), { recursive: true })

async function runBackendAsync(kind) {
  if (kind === 'direct') env.N_CURSOR_DOCGEN_BACKEND = 'omlx'
  else delete env.N_CURSOR_DOCGEN_BACKEND
  const out = { ok: 0, err: 0, totalMs: 0, scores: [], lengths: [], errors: [], times: [] }
  console.log(`\n══════ Backend: ${kind} ══════`)
  for (let i = 0; i < slice.length; i++) {
    const f = slice[i]
    const t0 = Date.now()
    const stem = basename(f.sourcePath).replace(/\.[^.]+$/, '')
    const destFile = join(TMP, kind, `${String(i + 1).padStart(2, '0')}-${stem}.md`)
    process.stdout.write(`  [${i + 1}/${slice.length}] sym=${f.sym} ${f.sourcePath} ... `)
    try {
      const r = await generateDoc(join(ROOT, f.sourcePath), { symThreshold: 999, cloudModel: null })
      writeFileSync(destFile, r.md)
      const ms = Date.now() - t0
      out.ok++
      out.totalMs += ms
      out.times.push(ms)
      out.scores.push(r.score ?? 0)
      out.lengths.push(r.md.length)
      process.stdout.write(`✓ ${Math.round(ms / 1000)}s score=${r.score ?? '?'} chars=${r.md.length}\n`)
    } catch (error) {
      out.err++
      out.errors.push({ path: f.sourcePath, msg: error.message })
      process.stdout.write(`✗ ${error.message}\n`)
    }
  }
  return out
}

const direct = await runBackendAsync('direct')
const pi = await runBackendAsync('pi')

function avg(a) { return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0 }
function median(a) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

const report = {
  files: slice.map(f => f.sourcePath),
  direct: { ok: direct.ok, err: direct.err, avgMs: avg(direct.times), medianMs: median(direct.times), avgScore: avg(direct.scores), avgChars: avg(direct.lengths), totalSec: Math.round(direct.totalMs / 1000) },
  pi: { ok: pi.ok, err: pi.err, avgMs: avg(pi.times), medianMs: median(pi.times), avgScore: avg(pi.scores), avgChars: avg(pi.lengths), totalSec: Math.round(pi.totalMs / 1000) }
}
writeFileSync(join(TMP, 'report.json'), JSON.stringify(report, null, 2))

console.log(`\n${'─'.repeat(60)}\nA/B SUMMARY (${slice.length} файлів, той самий оркестратор)\n${'─'.repeat(60)}`)
console.log(`Backend        | ok | err | avg s | median s | avg score | avg chars | total s`)
console.log(`direct (curl)  | ${direct.ok}  | ${direct.err}   | ${Math.round(report.direct.avgMs / 1000)}    | ${Math.round(report.direct.medianMs / 1000)}        | ${report.direct.avgScore}        | ${report.direct.avgChars}      | ${report.direct.totalSec}`)
console.log(`pi cli         | ${pi.ok}  | ${pi.err}   | ${Math.round(report.pi.avgMs / 1000)}    | ${Math.round(report.pi.medianMs / 1000)}        | ${report.pi.avgScore}        | ${report.pi.avgChars}      | ${report.pi.totalSec}`)
console.log(`\nФайли: ${TMP}/{direct,pi}/<idx>-<stem>.md\nReport: ${TMP}/report.json`)
