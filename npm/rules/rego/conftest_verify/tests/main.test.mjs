import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lint } from '../main.mjs'

describe('lint rego/conftest_verify', () => {
  test('returns no violations (skip) when no rego targets exist in cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lint-rego-conftest-verify-'))
    try {
      const { violations } = await lint({ cwd: root, ruleId: 'rego', concernId: 'conftest_verify', files: undefined })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
