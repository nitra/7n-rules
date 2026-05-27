import { describe, expect, test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check } from '../trufflehog.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

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
      expect(await check(dir)).toBe(1)
    })
  })

  test('fails when .trufflehog-exclude missing', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{}')
      expect(await check(dir)).toBe(1)
    })
  })

  test('fails when .trufflehog-exclude lacks canonical patterns', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{}')
      writeFileSync(join(dir, '.trufflehog-exclude'), 'foo\n')
      expect(await check(dir)).toBe(1)
    })
  })

  test('passes when both files present and exclude has canonical patterns', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{}')
      writeFileSync(join(dir, '.trufflehog-exclude'), CANON_EXCLUDE + '\n')
      expect(await check(dir)).toBe(0)
    })
  })
})
