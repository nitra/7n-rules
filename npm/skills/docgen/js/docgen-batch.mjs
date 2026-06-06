/**
 * Batch docgen для відсутніх файлів проєкту.
 * sym < 4 → gemma3:4b orchestrated (local)
 * sym ≥ 4 → Claude Sonnet (cloud, via generateDoc pre-routing)
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateDoc } from './docgen-gen.mjs'
import { extractFacts } from './docgen-extract.mjs'
import { execSync } from 'node:child_process'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..')

// 1. Отримати список відсутніх файлів
const scanOut = execSync('node npm/bin/n-cursor.js docgen scan', { cwd: ROOT, encoding: 'utf8' })
const allFiles = JSON.parse(scanOut)
const missing = allFiles.filter(x => !x.exists)

console.log(`\n📋 Файлів для генерації: ${missing.length}`)

// 2. Розкласти по тирах
const local = [], cloud = []
for (const f of missing) {
  try {
    const src = readFileSync(join(ROOT, f.sourcePath), 'utf8')
    const facts = extractFacts(src, join(ROOT, f.sourcePath))
    const sym = (facts.internalSymbols ?? []).length
    if (sym >= 4) cloud.push({ ...f, sym })
    else local.push({ ...f, sym })
  } catch { local.push({ ...f, sym: 0 }) }
}

console.log(`  Local (sym<4): ${local.length}`)
console.log(`  Cloud (sym≥4): ${cloud.length}`)

const stats = { ok: 0, err: 0, localOk: 0, cloudOk: 0, errors: [] }

// 3. Cloud файли (sym≥4) — generateDoc auto-routes до Claude
console.log('\n☁️  Cloud tier...')
for (const f of cloud) {
  const t0 = Date.now()
  try {
    const result = await generateDoc(join(ROOT, f.sourcePath), { symThreshold: 4 })
    const docAbs = join(ROOT, f.docPath)
    mkdirSync(dirname(docAbs), { recursive: true })
    writeFileSync(docAbs, result.md)
    stats.ok++
    stats.cloudOk++
    console.log(`  ✓ ${f.sourcePath} (sym=${f.sym}, ${Math.round((Date.now()-t0)/1000)}s)`)
  } catch(e) {
    stats.err++
    stats.errors.push(f.sourcePath)
    console.error(`  ✗ ${f.sourcePath}: ${e.message}`)
  }
}

// 4. Local файли (sym<4) — gemma3:4b orchestrated
console.log('\n💻 Local tier...')
let done = 0
for (const f of local) {
  done++
  const t0 = Date.now()
  const pct = Math.round(done/local.length*100)
  process.stdout.write(`  [${done}/${local.length} ${pct}%] ${f.sourcePath} ... `)
  try {
    const result = await generateDoc(join(ROOT, f.sourcePath), {
      mode: 'orchestrated',
      symThreshold: 999 // force local
    })
    const docAbs = join(ROOT, f.docPath)
    mkdirSync(dirname(docAbs), { recursive: true })
    writeFileSync(docAbs, result.md)
    stats.ok++
    stats.localOk++
    process.stdout.write(`✓ ${Math.round((Date.now()-t0)/1000)}s score=${result.score ?? '?'}\n`)
  } catch(e) {
    stats.err++
    stats.errors.push(f.sourcePath)
    process.stdout.write(`✗ ${e.message}\n`)
  }
}

// 5. Підсумок
console.log(`\n${'─'.repeat(50)}`)
console.log(`✓ OK: ${stats.ok}  ✗ Err: ${stats.err}`)
console.log(`  💻 Local (gemma3:4b): ${stats.localOk} файлів`)
console.log(`  ☁️  Cloud (Claude/pi): ${stats.cloudOk} файлів`)
if (stats.errors.length > 0) {
  console.log('Помилки:')
  stats.errors.forEach(e => console.log(`  - ${e}`))
}
