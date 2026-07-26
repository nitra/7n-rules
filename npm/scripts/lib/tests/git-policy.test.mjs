import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readGitPolicy } from '../git-policy.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

describe('readGitPolicy', () => {
  test('без конфігу зберігає main policy', async () => {
    await withTmpDir(dir => {
      expect(readGitPolicy(dir)).toEqual({
        baseBranch: 'main',
        releaseBranches: ['main'],
        integrationBranches: ['main'],
        protectedBranches: ['main']
      })
    })
  })

  test('обʼєднує base та всі release/integration гілки без дублікатів', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ git: { baseBranch: 'dev', releaseBranches: ['tr-qa', 'tr', 'dev', 'tr'] } })
      )
      expect(readGitPolicy(dir)).toEqual({
        baseBranch: 'dev',
        releaseBranches: ['tr-qa', 'tr', 'dev'],
        integrationBranches: ['dev', 'tr-qa', 'tr'],
        protectedBranches: ['dev', 'tr-qa', 'tr']
      })
    })
  })
})
