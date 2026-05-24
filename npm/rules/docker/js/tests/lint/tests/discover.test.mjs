/**
 * Тести фільтрації імен Dockerfile / *.Dockerfile та збору шляхів.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findDockerfilePaths, isDockerfileName } from '../../../lint.mjs'
import { findLintDockerfilePaths, isLintDockerfileName } from '../../../../lint/lint.mjs'
import { withTmpCwd } from '../../../../../../scripts/utils/test-helpers.mjs'

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

describe('isLintDockerfileName', () => {
  test('лише Dockerfile та *.Dockerfile', () => {
    expect(isLintDockerfileName('Dockerfile')).toBe(true)
    expect(isLintDockerfileName('app.Dockerfile')).toBe(true)
    expect(isLintDockerfileName('App.dockerfile')).toBe(true)
  })

  test('не Containerfile і не Dockerfile.*', () => {
    expect(isLintDockerfileName('Containerfile')).toBe(false)
    expect(isLintDockerfileName('Dockerfile.prod')).toBe(false)
  })
})

describe('findDockerfilePaths / findLintDockerfilePaths', () => {
  test('різні набори файлів', async () => {
    await withTmpCwd(async root => {
      await mkdir(join('a'), { recursive: true })
      await mkdir(join('b'), { recursive: true })
      await writeFile(join('Dockerfile'), 'FROM scratch\n', 'utf8')
      await writeFile(join('a', 'Dockerfile.dev'), 'FROM scratch\n', 'utf8')
      await writeFile(join('a', 'Containerfile'), 'FROM scratch\n', 'utf8')
      await writeFile(join('b', 'App.Dockerfile'), 'FROM scratch\n', 'utf8')

      const all = await findDockerfilePaths(root)
      expect(all.length).toBe(3)

      const lint = await findLintDockerfilePaths(root)
      expect(lint.length).toBe(2)
    })
  })
})
