/**
 * Smoke-контракт: кожне правило `rules/<id>/` має `fix.mjs` з валідним експортом `run`.
 * Каталог `fix/` (legacy) має бути відсутнім — convention перейшла на `js/`.
 * Doc-only правила (без `js/` і без `policy/`) допускаються — для них `fix.mjs` no-op повертає 0.
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

describe('fix.mjs contract — усі правила', () => {
  test('35 правил знайдено', () => {
    expect(ruleIds.length).toBe(35)
  })

  for (const id of ruleIds) {
    test(`${id}: rules/${id}/fix.mjs існує`, () => {
      expect(existsSync(join(RULES_DIR, id, 'fix.mjs'))).toBe(true)
    })

    test(`${id}: rules/${id}/fix.mjs експортує run()`, async () => {
      const mod = await import(pathToFileURL(join(RULES_DIR, id, 'fix.mjs')).href)
      expect(typeof mod.run).toBe('function')
    })

    test(`${id}: rules/${id}/ — без legacy fix/ каталогу`, () => {
      expect(existsSync(join(RULES_DIR, id, 'fix'))).toBe(false)
    })
  }
})
