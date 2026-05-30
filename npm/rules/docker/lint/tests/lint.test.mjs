/**
 * Тести для docker/lint/lint.mjs (pure helpers):
 *   - `isLintDockerfileName` — фільтр canonical Dockerfile та *.Dockerfile (case-insensitive);
 *   - `findLintDockerfilePaths` — обхід дерева з ignorePaths, сортування.
 *
 * Не тестуємо `runLintDocker*` бо вони залежать від `process.cwd()` і spawn-wrap-ів
 * (`runStandardLint`, `lintDockerfileWithHadolint`). Покривається integration-тестами.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { findLintDockerfilePaths, isLintDockerfileName } from '../lint.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('isLintDockerfileName', () => {
  test('канонічне ім\'я "Dockerfile" — true', () => {
    expect(isLintDockerfileName('Dockerfile')).toBe(true)
  })

  test('case-insensitive — "DOCKERFILE" та "dockerfile" — true', () => {
    expect(isLintDockerfileName('DOCKERFILE')).toBe(true)
    expect(isLintDockerfileName('dockerfile')).toBe(true)
  })

  test('суфікс .dockerfile з префіксом — true', () => {
    expect(isLintDockerfileName('app.Dockerfile')).toBe(true)
    expect(isLintDockerfileName('foo.dockerfile')).toBe(true)
    expect(isLintDockerfileName('FOO.DOCKERFILE')).toBe(true)
  })

  test('голий ".dockerfile" (без префікса) — false', () => {
    // n.length > '.dockerfile'.length вимагає принаймні 1 символ префікса
    expect(isLintDockerfileName('.dockerfile')).toBe(false)
  })

  test('Containerfile, Dockerfile.alpine, Dockerfile.dev — false', () => {
    expect(isLintDockerfileName('Containerfile')).toBe(false)
    expect(isLintDockerfileName('Dockerfile.alpine')).toBe(false)
    expect(isLintDockerfileName('Dockerfile.dev')).toBe(false)
  })

  test('не-Docker файли — false', () => {
    expect(isLintDockerfileName('README.md')).toBe(false)
    expect(isLintDockerfileName('compose.yaml')).toBe(false)
    expect(isLintDockerfileName('docker-compose.yml')).toBe(false)
  })
})

describe('findLintDockerfilePaths', () => {
  test('порожня директорія → []', async () => {
    await withTmpDir(async dir => {
      expect(await findLintDockerfilePaths(dir)).toEqual([])
    })
  })

  test('знаходить Dockerfile + *.Dockerfile у дереві', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'a'))
      await ensureDir(join(dir, 'b'))
      await writeFile(join(dir, 'Dockerfile'), 'FROM scratch\n', 'utf8')
      await writeFile(join(dir, 'a/app.Dockerfile'), 'FROM scratch\n', 'utf8')
      await writeFile(join(dir, 'b/README.md'), '', 'utf8')
      const result = await findLintDockerfilePaths(dir)
      expect(result).toHaveLength(2)
      const names = result.map(p => p.split('/').pop())
      expect(names).toContain('Dockerfile')
      expect(names).toContain('app.Dockerfile')
    })
  })

  test('відфільтровує Dockerfile.alpine, Containerfile, compose.yaml', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Dockerfile'), 'FROM x\n', 'utf8')
      await writeFile(join(dir, 'Dockerfile.alpine'), 'FROM x\n', 'utf8')
      await writeFile(join(dir, 'Containerfile'), 'FROM x\n', 'utf8')
      await writeFile(join(dir, 'compose.yaml'), '', 'utf8')
      const result = await findLintDockerfilePaths(dir)
      expect(result).toHaveLength(1)
      expect(result[0].endsWith('Dockerfile')).toBe(true)
    })
  })

  test('повертає відсортований за localeCompare масив', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'm'))
      await ensureDir(join(dir, 'a'))
      await ensureDir(join(dir, 'z'))
      await writeFile(join(dir, 'm/m.Dockerfile'), 'FROM x\n', 'utf8')
      await writeFile(join(dir, 'z/z.Dockerfile'), 'FROM x\n', 'utf8')
      await writeFile(join(dir, 'a/a.Dockerfile'), 'FROM x\n', 'utf8')
      const result = await findLintDockerfilePaths(dir)
      const names = result.map(p => p.split('/').pop())
      expect(names).toEqual(['a.Dockerfile', 'm.Dockerfile', 'z.Dockerfile'])
    })
  })

  test('ignorePaths виключає піддерево', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg-a'))
      await ensureDir(join(dir, 'pkg-b'))
      await writeFile(join(dir, 'pkg-a/Dockerfile'), 'FROM x\n', 'utf8')
      await writeFile(join(dir, 'pkg-b/Dockerfile'), 'FROM x\n', 'utf8')
      const result = await findLintDockerfilePaths(dir, [join(dir, 'pkg-b')])
      expect(result).toHaveLength(1)
      expect(result[0]).toContain('pkg-a')
    })
  })
})
