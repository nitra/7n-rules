/**
 * Тимчасовий A/B-batch: docgen Tier 1 через omlx (gemma-4-e2b 4bit на MLX)
 * замість pi/ollama. Перезаписує всі docs/<stem>.md для файлів з sym<4,
 * НЕ ескалює в cloud. Призначення — порівняння якості omlx vs попередньої версії.
 *
 * Запуск: node npm/skills/docgen/js/docgen-batch-omlx.mjs [--limit N] [--from N]
 *   --limit N — обробити перші N файлів зі списку sym<4
 *   --from N  — почати з індексу N (для дозапуску)
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { env } from 'node:process'
import { generateDoc } from './docgen-gen.mjs'
import { extractFacts } from './docgen-extract.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity
const fromIdx = args.indexOf('--from')
const from = fromIdx !== -1 ? Number(args[fromIdx + 1]) : 0

env.N_CURSOR_DOCGEN_BACKEND = 'omlx'

const scanOut = execSync('node npm/bin/n-cursor.js docgen scan', { cwd: ROOT, encoding: 'utf8' })
const all = JSON.parse(scanOut)

const local = []
for (const f of all) {
  try {
    const src = readFileSync(join(ROOT, f.sourcePath), 'utf8')
    const facts = extractFacts(src, join(ROOT, f.sourcePath))
    const sym = (facts.internalSymbols ?? []).length
    if (sym < 4) local.push({ ...f, sym })
  } catch {
    /* пропускаємо нечитані */
  }
}

const slice = local.slice(from, from + limit)
console.log(`📋 Файлів sym<4 у проєкті: ${local.length}; обробляємо: ${slice.length} (from=${from}, limit=${limit === Infinity ? 'усе' : limit})`)
console.log(`🤖 Бекенд: omlx → ${env.N_CURSOR_DOCGEN_OMLX_URL ?? 'http://127.0.0.1:8000/v1/chat/completions'}`)

const stats = { ok: 0, err: 0, totalMs: 0, scores: [], errors: [] }

for (let i = 0; i < slice.length; i++) {
  const f = slice[i]
  const t0 = Date.now()
  const pct = Math.round(((i + 1) / slice.length) * 100)
  process.stdout.write(`  [${i + 1}/${slice.length} ${pct}%] sym=${f.sym} ${f.sourcePath} ... `)
  try {
    const result = await generateDoc(join(ROOT, f.sourcePath), {
      symThreshold: 999, // не уходити в cloud за sym
      cloudModel: null // повністю вимкнути cloud-fallback навіть при low det-score
    })
    const docAbs = join(ROOT, f.docPath)
    mkdirSync(dirname(docAbs), { recursive: true })
    writeFileSync(docAbs, result.md)
    const ms = Date.now() - t0
    stats.ok++
    stats.totalMs += ms
    stats.scores.push(result.score ?? 0)
    process.stdout.write(`✓ ${Math.round(ms / 1000)}s score=${result.score ?? '?'} tier=${result.tier}\n`)
  } catch (error) {
    stats.err++
    stats.errors.push({ path: f.sourcePath, msg: error.message })
    process.stdout.write(`✗ ${error.message}\n`)
  }
}

const avgScore = stats.scores.length ? Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length) : 0
console.log(`\n${'─'.repeat(60)}`)
console.log(`✓ OK: ${stats.ok}  ✗ Err: ${stats.err}`)
console.log(`  Сумарний час: ${Math.round(stats.totalMs / 1000)}s; середній на файл: ${stats.ok ? Math.round(stats.totalMs / stats.ok / 1000) : 0}s`)
console.log(`  Середній det-score: ${avgScore}`)
if (stats.errors.length) {
  console.log('Помилки:')
  for (const e of stats.errors) console.log(`  - ${e.path}: ${e.msg}`)
}
