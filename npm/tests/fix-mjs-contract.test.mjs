/**
 * Smoke-контракт: кожне правило `rules/<id>/` має `fix.mjs` з валідним експортом `run`.
 * Каталог `fix/` (legacy) має бути відсутнім — convention перейшла на `js/`.
 * Doc-only правила (без `js/` і без `policy/`) допускаються — для них `fix.mjs` no-op повертає 0.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const RULES_DIR = new URL('../rules/', import.meta.url).pathname

const rulesEntries = await readdir(RULES_DIR, { withFileTypes: true })
const ruleIds = rulesEntries
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .map(e => e.name)
  .toSorted((a, b) => a.localeCompare(b))

describe('fix.mjs contract — усі правила', () => {
  test('30 правил знайдено', () => {
    expect(ruleIds.length).toBe(30)
  })

  for (const id of ruleIds) {
    test(`${id}: rules/${id}/fix.mjs існує`, () => {
      expect(existsSync(join(RULES_DIR, id, 'fix.mjs'))).toBe(true)
    })

    test(`${id}: rules/${id}/fix.mjs експортує run()`, async () => {
      const mod = await import(join(RULES_DIR, id, 'fix.mjs'))
      expect(typeof mod.run).toBe('function')
    })

    test(`${id}: rules/${id}/ — без legacy fix/ каталогу`, () => {
      expect(existsSync(join(RULES_DIR, id, 'fix'))).toBe(false)
    })
  }
})
