/**
 * Тести capability-гейта концернів: `requires.capability` у concern.json активує концерн
 * лише коли capability надана (плагіном або явним opts.capabilities).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildDetectPlan } from '../run-detectors.mjs'
import { withTmpDir } from '../../../utils/test-helpers.mjs'

/**
 * Створює tmp rules-каталог з двома концернами: гейтований (ci:github) і вільний.
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} шлях rules-каталогу
 */
async function writeRules(dir) {
  const rulesDir = join(dir, 'rules')
  for (const [concern, meta] of [
    ['gated', { lint: { scope: 'full', glob: ['*.txt'] }, requires: { capability: 'ci:github' } }],
    ['free', { lint: { scope: 'full', glob: ['*.txt'] } }]
  ]) {
    const cdir = join(rulesDir, 'demo', concern)
    await mkdir(cdir, { recursive: true })
    await writeFile(join(cdir, 'concern.json'), JSON.stringify(meta))
  }
  return rulesDir
}

describe('capability-гейт', () => {
  test('без capability гейтований концерн випадає з плану', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await writeRules(dir)
      const plan = await buildDetectPlan({ rulesDirs: [rulesDir], cwd: dir, rules: ['demo'], capabilities: [] })
      expect(plan.map(p => p.entry.concern.name)).toEqual(['free'])
    })
  })

  test('з capability ci:github гейтований концерн активний', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await writeRules(dir)
      const plan = await buildDetectPlan({
        rulesDirs: [rulesDir],
        cwd: dir,
        rules: ['demo'],
        capabilities: ['ci:github']
      })
      expect(plan.map(p => p.entry.concern.name).toSorted()).toEqual(['free', 'gated'])
    })
  })
})
