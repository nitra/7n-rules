/**
 * Рефрешить `scripts/lib/tool-pins.json` — закріплені версії зовнішніх CLI-тулів
 * (`ensure-tool.mjs`, Linux/Windows-fallback install-шлях) і дату піна.
 *
 * Запуск (вручну, у \@7n/rules):
 *   bun npm/scripts/tool-pins-refresh.mjs
 *
 * Коли запускати:
 *   - Тест `tool-pins-freshness.test.mjs` червоніє (пінам > 30 днів) — сигнал у CI/локально;
 *   - Відома вразливість/баг у одному з закріплених тулів — рефрешни раніше терміну;
 *   - Просто хочеться підняти версії тулів на актуальні.
 *
 * Для кожного тула з реєстру `TOOLS` резолвить останній реліз через `fetchLatestVersion`
 * (GitHub API з `GITHUB_TOKEN`/`GH_TOKEN` за наявності, fallback — redirect повз API) і
 * переписує `tool-pins.json` зі свіжими версіями та сьогоднішньою `pinnedAt`. Друкує
 * діф версій (незмінені тули не показуються). Мережеві виклики йдуть лише тут — звичайний
 * `ensureTool`/CI-lint install ніколи не резолвить `latest`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOOLS, fetchLatestVersion } from './lib/ensure-tool.mjs'
import { resolveCmd } from './utils/resolve-cmd.mjs'

const PINS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'tool-pins.json')

const curlBin = resolveCmd('curl')
if (!curlBin) throw new Error('curl не знайдено в PATH — потрібен для рефрешу tool-pins.json')

const current = JSON.parse(readFileSync(PINS_PATH, 'utf8'))
/** @type {Record<string, string>} */
const nextVersions = {}
const changes = []

for (const [toolId, entry] of Object.entries(TOOLS)) {
  process.stdout.write(`⏳ ${toolId} …`)
  const version = fetchLatestVersion(entry.github, curlBin)
  nextVersions[toolId] = version
  const prev = current.versions[toolId]
  if (prev !== version) changes.push({ toolId, prev: prev ?? '(немає)', version })
  console.log('\r✓ ' + toolId + ': ' + version + (prev && prev !== version ? ' (було ' + prev + ')' : ''))
}

const pinnedAt = new Date().toISOString().slice(0, 10)
writeFileSync(PINS_PATH, `${JSON.stringify({ pinnedAt, versions: nextVersions }, null, 2)}\n`, 'utf8')

console.log(`\n📌 tool-pins.json оновлено, pinnedAt: ${pinnedAt}`)
if (changes.length === 0) {
  console.log('   Версії без змін — лише дата піна освіжена.')
} else {
  console.log(`   Змінено ${changes.length} тул(ів):`)
  for (const c of changes) console.log(`   - ${c.toolId}: ${c.prev} → ${c.version}`)
}
