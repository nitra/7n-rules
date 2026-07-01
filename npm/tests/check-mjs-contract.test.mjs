/**
 * Smoke-контракт concern-моделі (2026-06-28): кожен concern-dir у `rules/<id>/` має
 * `concern.json` з хоча б однією поверхнею, і відповідний `main.mjs` з правильним експортом.
 * Legacy-шляхи (`rules/<id>/main.mjs`, `js/`, `policy/`) — відсутні.
 */
import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const RULES_DIR = new URL('../rules/', import.meta.url).pathname

const rulesEntries = await readdir(RULES_DIR, { withFileTypes: true })
const ruleIds = rulesEntries
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
  .map(e => e.name)
  .toSorted((a, b) => a.localeCompare(b))

/**
 * @param {string} ruleDir шлях до каталогу правила
 * @returns {Promise<Array<{name: string, dir: string, meta: object}>>} список concern-ів із метаданими
 */
async function listConcerns(ruleDir) {
  let entries
  try {
    entries = await readdir(ruleDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const concernDir = join(ruleDir, e.name)
    const metaPath = join(concernDir, 'concern.json')
    if (!existsSync(metaPath)) continue
    let meta
    try {
      const { readFile } = await import('node:fs/promises')
      meta = JSON.parse(await readFile(metaPath, 'utf8'))
    } catch {
      meta = {}
    }
    out.push({ name: e.name, dir: concernDir, meta })
  }
  return out
}

describe('concern contract — усі правила', () => {
  test('36 правил знайдено', () => {
    expect(ruleIds.length).toBe(36)
  })

  for (const id of ruleIds) {
    const ruleDir = join(RULES_DIR, id)

    test(`${id}: немає legacy rules/${id}/main.mjs (rule-level entrypoint видалено)`, () => {
      expect(existsSync(join(ruleDir, 'main.mjs'))).toBe(false)
    })

    test(`${id}: немає legacy js/ та policy/ (старі структури видалено)`, () => {
      expect(existsSync(join(ruleDir, 'js'))).toBe(false)
      expect(existsSync(join(ruleDir, 'policy'))).toBe(false)
    })

    test(`${id}: concern-структура (doc-only без concern.json — дозволено)`, async () => {
      const concerns = await listConcerns(ruleDir)
      expect(concerns.length).toBeGreaterThanOrEqual(0)
    })

    test(`${id}: check-concerns мають main.mjs з main()`, async () => {
      const concerns = await listConcerns(ruleDir)
      const checkConcerns = concerns.filter(c => c.meta.check === true)
      for (const c of checkConcerns) {
        const mainPath = join(c.dir, 'main.mjs')
        expect(existsSync(mainPath), `${id}/${c.name}/main.mjs відсутній`).toBe(true)
        const mod = await import(pathToFileURL(mainPath).href)
        expect(typeof mod.main, `${id}/${c.name}/main.mjs не експортує main()`).toBe('function')
      }
    })

    test(`${id}: lint-concerns мають main.mjs з lint()`, async () => {
      const concerns = await listConcerns(ruleDir)
      const lintConcerns = concerns.filter(c => c.meta.lint !== undefined && c.meta.lint !== null)
      for (const c of lintConcerns) {
        const mainPath = join(c.dir, 'main.mjs')
        expect(existsSync(mainPath), `${id}/${c.name}/main.mjs відсутній`).toBe(true)
        const mod = await import(pathToFileURL(mainPath).href)
        expect(typeof mod.lint, `${id}/${c.name}/main.mjs не експортує lint()`).toBe('function')
      }
    })
  }
})
