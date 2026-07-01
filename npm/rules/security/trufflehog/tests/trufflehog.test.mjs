import { describe, expect, test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'security', concernId: 'trufflehog', files: undefined })

const CANON_EXCLUDE = [
  '(^|/)node_modules(/|$)',
  String.raw`(^|/)\.git(/|$)`,
  '(^|/)dist(/|$)',
  '(^|/)build(/|$)',
  String.raw`.*\.lock$`,
  '.*fixtures?/.*'
].join('\n')

describe('security/js/trufflehog/check', () => {
  test('fails when package.json missing', async () => {
    await withTmpDir(async dir => {
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('fails when .trufflehog-exclude missing', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{}')
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('fails when .trufflehog-exclude lacks canonical patterns', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{}')
      writeFileSync(join(dir, '.trufflehog-exclude'), 'foo\n')
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('passes when both files present and exclude has canonical patterns', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{}')
      writeFileSync(join(dir, '.trufflehog-exclude'), CANON_EXCLUDE + '\n')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })
})
