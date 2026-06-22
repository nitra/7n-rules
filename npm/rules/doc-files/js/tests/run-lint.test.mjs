import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import { runLintDocFilesSteps } from '../run-lint.mjs'
import { crc32, stampDoc } from '../docgen-crc.mjs'

describe('runLintDocFilesSteps (lint-doc-files)', () => {
  test('повний прогін зі stale → exit 1', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(runLintDocFilesSteps(['--root', root])).toBe(1)
    })
  })

  test('усе свіже → exit 0', async () => {
    await withTmpDir(async root => {
      const body = 'export const a = 1\n'
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'a.mjs'), body)
      await writeFile(
        join(root, 'src', 'docs', 'a.md'),
        stampDoc('# a\n\n## Огляд\n\nx\n', 'src/a.mjs', crc32(Buffer.from(body)))
      )
      expect(runLintDocFilesSteps(['--root', root])).toBe(0)
    })
  })

  test('--missing-only пропускає crc-mismatch (лише missing)', async () => {
    await withTmpDir(async root => {
      // a.mjs: дока є, але CRC застарів (crc-mismatch); b.mjs: доки немає (missing).
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 2\n')
      await writeFile(
        join(root, 'src', 'docs', 'a.md'),
        stampDoc('# a\n\n## Огляд\n\nx\n', 'src/a.mjs', crc32(Buffer.from('OLD')))
      )
      await writeFile(join(root, 'src', 'b.mjs'), 'export const b = 1\n')
      // Без --missing-only обидва stale → 1; з --missing-only теж 1 (b.mjs missing).
      expect(runLintDocFilesSteps(['--root', root, '--missing-only'])).toBe(1)
    })
  })

  test('точковий прогін по заданому шляху', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(runLintDocFilesSteps(['--root', root, 'src/a.mjs'])).toBe(1)
    })
  })

  test('неіснуючий корінь → exit 1', () => {
    expect(runLintDocFilesSteps(['--root', '/no/such/dir/xyz'])).toBe(1)
  })

  test('сирітська дока (source видалено) → exit 1', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src', 'docs'))
      // Дока з resource: + crc, але src/ghost.mjs не існує → orphan
      await writeFile(
        join(root, 'src', 'docs', 'ghost.md'),
        stampDoc('## Огляд\n\nтест\n', 'src/ghost.mjs', 'deadbeef')
      )
      expect(runLintDocFilesSteps(['--root', root])).toBe(1)
    })
  })

  test('точковий прогін не перевіряє orphan', async () => {
    await withTmpDir(async root => {
      const body = 'export const a = 1\n'
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'a.mjs'), body)
      await writeFile(
        join(root, 'src', 'docs', 'a.md'),
        stampDoc('# a\n\n## Огляд\n\nx\n', 'src/a.mjs', crc32(Buffer.from(body)))
      )
      // Orphan дока існує, але перевіряємо конкретний файл → orphan-scan не запускається
      await writeFile(
        join(root, 'src', 'docs', 'ghost.md'),
        stampDoc('## Огляд\n\nтест\n', 'src/ghost.mjs', 'deadbeef')
      )
      expect(runLintDocFilesSteps(['--root', root, 'src/a.mjs'])).toBe(0)
    })
  })
})
