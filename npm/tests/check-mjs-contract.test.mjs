/**
 * Smoke-контракт: кожне правило `rules/<id>/` має єдиний entrypoint `main.mjs` з валідним
 * експортом `run` (канон ADR 2026-06-21). Каталоги `fix/` і `check.mjs` (legacy) — відсутні.
 * Doc-only правила (без `js/` і без `policy/`) допускаються — для них `run` no-op повертає 0.
 */
import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const RULES_DIR = new URL('../rules/', import.meta.url).pathname

const rulesEntries = await readdir(RULES_DIR, { withFileTypes: true })
const ruleIds = rulesEntries
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .map(e => e.name)
  .toSorted((a, b) => a.localeCompare(b))

describe('entrypoint contract — усі правила', () => {
  test('38 правил знайдено', () => {
    expect(ruleIds.length).toBe(38)
  })

  for (const id of ruleIds) {
    test(`${id}: rules/${id}/main.mjs існує`, () => {
      expect(existsSync(join(RULES_DIR, id, 'main.mjs'))).toBe(true)
    })

    test(`${id}: main.mjs експортує run()`, async () => {
      const mod = await import(pathToFileURL(join(RULES_DIR, id, 'main.mjs')).href)
      expect(typeof mod.run).toBe('function')
    })

    test(`${id}: rules/${id}/ — без legacy check.mjs / fix/`, () => {
      expect(existsSync(join(RULES_DIR, id, 'check.mjs'))).toBe(false)
      expect(existsSync(join(RULES_DIR, id, 'fix'))).toBe(false)
    })
  }
})
