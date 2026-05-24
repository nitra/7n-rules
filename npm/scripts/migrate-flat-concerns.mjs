/**
 * Одноразова міграція: `rules/<rule>/js/<concern>/{check.mjs,helpers,tests,template,data}`
 * → flat-структура:
 *   - `js/<concern>.mjs` (concern entry)
 *   - `js/tests/<concern>.test.mjs` або `js/tests/<concern>/...` (JS tests)
 *   - `js/templates/<concern>/...` (JS templates)
 *   - `js/data/<concern>/...` (JS data, json/tsv)
 *   - `<rule>/utils/<helper>.mjs` (helpers — peer до js/, existing convention від abie/utils/)
 *
 * Працює з `git mv` (зберігає історію). Видалити після успішного PR.
 *
 * Run: bun npm/scripts/migrate-flat-concerns.mjs
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const RULES_DIR = new URL('../rules/', import.meta.url).pathname

function gitMv(from, to) {
  const res = spawnSync('git', ['mv', from, to], { stdio: 'inherit' })
  if (res.status !== 0) throw new Error(`git mv ${from} → ${to} failed`)
}

async function migrateOneRule(ruleDir, ruleId) {
  const jsDir = join(ruleDir, 'js')
  if (!existsSync(jsDir)) return

  const concerns = (await readdir(jsDir, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))

  for (const concernEntry of concerns) {
    const concern = concernEntry.name
    const concernDir = join(jsDir, concern)
    const entries = await readdir(concernDir, { withFileTypes: true })

    // 1. Rename check.mjs → <concern>.mjs.tmp (avoid collision з папкою concern/)
    if (entries.some(e => e.isFile() && e.name === 'check.mjs')) {
      gitMv(join(concernDir, 'check.mjs'), join(jsDir, `${concern}.mjs.tmp`))
    }

    // 2. Move helpers → <rule>/utils/<helper>.mjs (peer до js/, плоско)
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name === 'check.mjs') continue
      if (entry.name.endsWith('.mjs')) {
        await mkdir(join(ruleDir, 'utils'), { recursive: true })
        const dest = join(ruleDir, 'utils', entry.name)
        if (existsSync(dest)) {
          throw new Error(`utils collision: ${dest} вже існує. Перейменуй helper'а або глянь конфлікт вручну.`)
        }
        gitMv(join(concernDir, entry.name), dest)
      }
    }

    // 3. Move data files (json/tsv) → js/data/<concern>/
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.mjs')) continue
      await mkdir(join(jsDir, 'data', concern), { recursive: true })
      gitMv(join(concernDir, entry.name), join(jsDir, 'data', concern, entry.name))
    }

    // 4. Move template/ → js/templates/<concern>/
    if (entries.some(e => e.isDirectory() && e.name === 'template')) {
      await mkdir(join(jsDir, 'templates'), { recursive: true })
      gitMv(join(concernDir, 'template'), join(jsDir, 'templates', concern))
    }

    // 5. Move tests/ → js/tests/<concern>/ або js/tests/<concern>.test.mjs
    if (entries.some(e => e.isDirectory() && e.name === 'tests')) {
      const testsSrc = join(concernDir, 'tests')
      const testsContents = await readdir(testsSrc, { withFileTypes: true })
      const onlyOneTestFile =
        testsContents.length === 1 &&
        testsContents[0].isFile() &&
        testsContents[0].name === 'check.test.mjs'
      await mkdir(join(jsDir, 'tests'), { recursive: true })
      if (onlyOneTestFile) {
        gitMv(join(testsSrc, 'check.test.mjs'), join(jsDir, 'tests', `${concern}.test.mjs`))
        await rmdir(testsSrc)
      } else {
        gitMv(testsSrc, join(jsDir, 'tests', concern))
      }
    }

    // 6. Remove empty concernDir/
    await rmdir(concernDir).catch(() => {
      console.warn(`⚠️  ${concernDir} не порожній — залишилось щось не оброблене`)
    })

    // 7. Rename <concern>.mjs.tmp → <concern>.mjs
    if (existsSync(join(jsDir, `${concern}.mjs.tmp`))) {
      gitMv(join(jsDir, `${concern}.mjs.tmp`), join(jsDir, `${concern}.mjs`))
    }
  }
}

const ruleEntries = (await readdir(RULES_DIR, { withFileTypes: true }))
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .toSorted((a, b) => a.name.localeCompare(b.name))

for (const entry of ruleEntries) {
  console.log(`\n=== ${entry.name} ===`)
  await migrateOneRule(join(RULES_DIR, entry.name), entry.name)
}

console.log('\n✅ Міграція завершена')
