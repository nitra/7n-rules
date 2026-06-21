/**
 * Тести фільтрації імен Dockerfile / Containerfile та збору шляхів.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findDockerfilePaths, isDockerfileName } from '../../../lint.mjs'
import { withTmpDir } from '../../../../../../scripts/utils/test-helpers.mjs'

describe('isDockerfileName', () => {
  test('канонічні імена', () => {
    expect(isDockerfileName('Dockerfile')).toBe(true)
    expect(isDockerfileName('dockerfile')).toBe(true)
    expect(isDockerfileName('Dockerfile.prod')).toBe(true)
    expect(isDockerfileName('Containerfile')).toBe(true)
    expect(isDockerfileName('containerfile.dev')).toBe(true)
  })

  test('відсікає сторонні файли', () => {
    expect(isDockerfileName('Dockerfile.txt')).toBe(true)
    expect(isDockerfileName('not-docker')).toBe(false)
    expect(isDockerfileName('Dockerfile')).toBe(true)
  })
})

describe('findDockerfilePaths', () => {
  test('збирає Dockerfile / Containerfile у дереві', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'a'), { recursive: true })
      await mkdir(join(root, 'b'), { recursive: true })
      await writeFile(join(root, 'Dockerfile'), 'FROM scratch\n', 'utf8')
      await writeFile(join(root, 'a', 'Dockerfile.dev'), 'FROM scratch\n', 'utf8')
      await writeFile(join(root, 'a', 'Containerfile'), 'FROM scratch\n', 'utf8')
      await writeFile(join(root, 'b', 'App.Dockerfile'), 'FROM scratch\n', 'utf8')

      const all = await findDockerfilePaths(root)
      expect(all.length).toBe(3)
    })
  })
})
