import { describe, expect, test } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { evaluatePolicyConcern } from '../policy-lint-adapter.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

describe('evaluatePolicyConcern — template engine', () => {
  test('missing required:single → policy-file-missing', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'concern')
      await mkdir(concernDir, { recursive: true })
      const r = await evaluatePolicyConcern(
        { cwd: dir, ruleId: 'ga', concernId: 'lint_ga' },
        { engine: 'template', policyDir: concernDir, files: { single: 'missing.yml', required: true } }
      )
      expect(r.violations).toHaveLength(1)
      expect(r.violations[0]).toMatchObject({ reason: 'policy-file-missing', file: 'missing.yml' })
    })
  })

  test('template subset порушено → policy-template-mismatch', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'concern')
      await mkdir(join(concernDir, 'template'), { recursive: true })
      // canon вимагає {"a":1}; target має лише {"b":2}
      await writeJson(join(concernDir, 'template', 'settings.json.snippet.json'), { a: 1 })
      await mkdir(join(dir, '.vscode'), { recursive: true })
      await writeJson(join(dir, '.vscode', 'settings.json'), { b: 2 })
      const r = await evaluatePolicyConcern(
        { cwd: dir, ruleId: 'worktree', concernId: 'vscode_settings' },
        { engine: 'template', policyDir: concernDir, files: { single: '.vscode/settings.json' } }
      )
      expect(r.violations.length).toBeGreaterThan(0)
      expect(r.violations[0].reason).toBe('policy-template-mismatch')
      expect(r.violations[0].file).toBe('.vscode/settings.json')
    })
  })

  test('template subset виконано → 0 violations', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'concern')
      await mkdir(join(concernDir, 'template'), { recursive: true })
      await writeJson(join(concernDir, 'template', 'settings.json.snippet.json'), { a: 1 })
      await mkdir(join(dir, '.vscode'), { recursive: true })
      await writeJson(join(dir, '.vscode', 'settings.json'), { a: 1, b: 2 })
      const r = await evaluatePolicyConcern(
        { cwd: dir, ruleId: 'worktree', concernId: 'vscode_settings' },
        { engine: 'template', policyDir: concernDir, files: { single: '.vscode/settings.json' } }
      )
      expect(r.violations).toEqual([])
    })
  })
})
