import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import { isSourceFile, docPathForSource, isDocCandidate, describeFile, scanForDocFiles } from '../docgen-scan.mjs'
import { crc32, stampDoc } from '../docgen-crc.mjs'

describe('isSourceFile', () => {
  test('документує .js/.mjs/.ts/.vue/.py', () => {
    for (const f of ['foo.js', 'foo.mjs', 'foo.ts', 'Foo.vue', 'foo.py']) expect(isSourceFile(f)).toBe(true)
  })

  test('пропускає .d.ts, тести й некодові розширення', () => {
    for (const f of ['types.d.ts', 'foo.test.js', 'foo.spec.ts', 'README.md', 'package.json']) {
      expect(isSourceFile(f)).toBe(false)
    }
  })
})

describe('docPathForSource', () => {
  test('кладе docs/<stem>.md поряд із джерелом', () => {
    expect(docPathForSource(join('src', 'lib', 'foo.js'))).toBe(join('src', 'lib', 'docs', 'foo.md'))
    expect(docPathForSource('root.mjs')).toBe(join('docs', 'root.md'))
  })
})

describe('isDocCandidate', () => {
  test('кодовий файл у дереві — кандидат; ignore-дерева й тести — ні', async () => {
    await withTmpDir(async root => {
      expect(isDocCandidate(root, 'src/a.js')).toBe(true)
      expect(isDocCandidate(root, 'node_modules/pkg/x.js')).toBe(false)
      expect(isDocCandidate(root, 'src/a.test.js')).toBe(false)
      expect(isDocCandidate(root, 'src/docs/a.md')).toBe(false)
    })
  })
})

describe('scanForDocFiles (CRC staleness)', () => {
  test('відсутня дока → stale:missing; ігнорує службові дерева й root-level', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs', 'adr')) // system-wide docs root → root-level файли не цільові
      await ensureDir(join(root, 'src'))
      await ensureDir(join(root, 'node_modules', 'pkg'))
      await writeFile(join(root, 'src', 'a.js'), 'export const a = 1\n')
      await writeFile(join(root, 'b.ts'), 'export const b = 2\n')
      await writeFile(join(root, 'node_modules', 'pkg', 'x.js'), 'noop\n')

      const items = scanForDocFiles(root)
      expect(items.map(i => i.sourcePath)).toEqual(['src/a.js'])
      expect(items[0]).toMatchObject({ docPath: join('src', 'docs', 'a.md'), stale: true, reason: 'missing' })
    })
  })

  test('свіжа дока (CRC збігся) → stale:false; зміна джерела → crc-mismatch', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'foo.js'), 'export const a = 1\n')
      await writeFile(join(root, 'src', 'docs', 'foo.md'), stampDoc('## Огляд\n', 'src/foo.js', crc32('export const a = 1\n')))

      expect(describeFile(root, 'src/foo.js')).toMatchObject({ stale: false, reason: null })

      await writeFile(join(root, 'src', 'foo.js'), 'export const a = 999\n')
      expect(describeFile(root, 'src/foo.js')).toMatchObject({ stale: true, reason: 'crc-mismatch' })
    })
  })
})
