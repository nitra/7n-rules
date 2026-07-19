/**
 * Тести T0-патерну `js-check-oxlintrc` з `fix-check.mjs`: відсутній
 * `.oxlintrc.json` копіюється з канону, наявний, але розбіжний з каноном,
 * доводиться до канону детермінованим merge (без LLM-ладдер).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { patterns } from '../fix-check.mjs'
import {
  OXLINT_CANONICAL_JSON_PATH,
  OXLINTRC_DRIFT,
  OXLINTRC_MISSING,
  verifyOxlintRcAgainstCanonical
} from '../../tooling/main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const P = patterns[1]
const canonicalOxlint = JSON.parse(await readFile(OXLINT_CANONICAL_JSON_PATH, 'utf8'))

describe('js-check-oxlintrc pattern', () => {
  test('id', () => {
    expect(P.id).toBe('js-check-oxlintrc')
  })

  test('test: true на oxlintrc-missing/oxlintrc-drift', () => {
    expect(P.test([{ reason: OXLINTRC_MISSING, message: 'm' }])).toBe(true)
    expect(P.test([{ reason: OXLINTRC_DRIFT, message: 'm' }])).toBe(true)
  })

  test('test: false на eslint-config/інших (не цей патерн)', () => {
    expect(P.test([{ reason: 'eslint-config-missing', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })

  test('відсутній .oxlintrc.json → apply копіює канон, verify ok', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: OXLINTRC_MISSING, message: 'm' }]
      const res = await P.apply(violations, { cwd: dir, ruleId: 'js', concernId: 'check' })
      expect(res.touchedFiles).toEqual([join(dir, '.oxlintrc.json')])
      const written = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf8'))
      expect(verifyOxlintRcAgainstCanonical(written, canonicalOxlint).ok).toBe(true)
    })
  })

  test('.oxlintrc.json розбіжний з каноном (off-правило, зайвий local rule) → apply зливає до канону й зберігає розширення', async () => {
    await withTmpDir(async dir => {
      const drifted = {
        ...canonicalOxlint,
        rules: { ...canonicalOxlint.rules, eqeqeq: 'off', 'local/custom-rule': 'warn' }
      }
      await writeFile(join(dir, '.oxlintrc.json'), JSON.stringify(drifted), 'utf8')
      const violations = [{ reason: OXLINTRC_DRIFT, message: 'm' }]
      await P.apply(violations, { cwd: dir, ruleId: 'js', concernId: 'check' })
      const written = JSON.parse(await readFile(join(dir, '.oxlintrc.json'), 'utf8'))
      expect(verifyOxlintRcAgainstCanonical(written, canonicalOxlint).ok).toBe(true)
      expect(written.rules['local/custom-rule']).toBe('warn')
    })
  })

  test('recordWrite викликається до запису (pre-image для central rollback)', async () => {
    await withTmpDir(async dir => {
      const calls = []
      await P.apply([{ reason: OXLINTRC_MISSING, message: 'm' }], {
        cwd: dir,
        ruleId: 'js',
        concernId: 'check',
        recordWrite: p => {
          calls.push(p)
        }
      })
      expect(calls).toEqual([join(dir, '.oxlintrc.json')])
    })
  })
})
