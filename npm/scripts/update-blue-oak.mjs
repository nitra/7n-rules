/**
 * Оновлює вбудований snapshot Blue Oak Council license list.
 *
 * Fetching: https://blueoakcouncil.org/list.json
 * Виводить: npm/data/blue-oak.json — SPDX-ідентифікатори рівнів Model+Gold+Silver+Bronze.
 *
 * Запуск (вручну, у \@nitra/cursor):
 *   bun npm/scripts/update-blue-oak.mjs
 *
 * Коли запускати:
 *   - При апгрейді \@nitra/cursor (n-taze або вручну) — Blue Oak список змінюється рідко,
 *     але нові permissive ліцензії зʼявляються раз на кілька місяців;
 *   - Якщо проєкт падає на license-check через ліцензію якої нема в списку,
 *     а вона точно permissive — спочатку перевір, чи вона в Bronze+ на blueoakcouncil.org.
 *
 * Lead-рівень (найгірший, GPL-compatible) — навмисно виключений.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BLUE_OAK_URL = 'https://blueoakcouncil.org/list.json'
const OUT_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'blue-oak.json')
const KEEP_RATINGS = new Set(['Model', 'Gold', 'Silver', 'Bronze'])

console.log(`⬇  Fetching ${BLUE_OAK_URL} …`)
const res = await fetch(BLUE_OAK_URL)
if (!res.ok) {
  throw new Error(`✗ HTTP ${res.status}`)
}

/** @type {{ version: string, ratings: Array<{ name: string, licenses: Array<{ id: string, name: string, url: string }> }> }} */
const data = await res.json()

const bronzeAndAbove = []
for (const rating of data.ratings) {
  if (KEEP_RATINGS.has(rating.name)) {
    bronzeAndAbove.push(...rating.licenses.map(l => l.id))
  }
}

const out = {
  version: data.version,
  source: BLUE_OAK_URL,
  bronzeAndAbove
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`✓ ${OUT_PATH}`)
console.log(`  version=${out.version}  bronzeAndAbove=${bronzeAndAbove.length} licenses`)
