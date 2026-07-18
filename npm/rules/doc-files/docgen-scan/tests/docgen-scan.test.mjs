import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  isSourceFile,
  docPathForSource,
  isDocCandidate,
  describeFile,
  scanForDocFiles,
  scanOrphanedDocs
} from '../main.mjs'
import { crc32, stampDoc } from '../../docgen-crc/main.mjs'

describe('isSourceFile', () => {
  test('документує вбудовані .js/.mjs/.ts/.vue', () => {
    for (const f of ['foo.js', 'foo.mjs', 'foo.ts', 'Foo.vue']) expect(isSourceFile(f)).toBe(true)
  })

  test('.py/.rs — лише з root і активним lang-плагіном (декларація в маніфесті)', () => {
    // Без root — плагінні розширення недоступні (hot-path fallback).
    expect(isSourceFile('foo.py')).toBe(false)
    expect(isSourceFile('lib.rs')).toBe(false)
    // З root монорепо (плагіни активні в .n-rules.json) — документуються.
    const repoRoot = new URL('../../../../..', import.meta.url).pathname
    expect(isSourceFile('foo.py', repoRoot)).toBe(true)
    expect(isSourceFile('lib.rs', repoRoot)).toBe(true)
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
    await withTmpDir(root => {
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
      await writeFile(
        join(root, 'src', 'docs', 'foo.md'),
        stampDoc('## Огляд\n', 'src/foo.js', crc32('export const a = 1\n'))
      )

      expect(describeFile(root, 'src/foo.js')).toMatchObject({ stale: false, reason: null })

      await writeFile(join(root, 'src', 'foo.js'), 'export const a = 999\n')
      expect(describeFile(root, 'src/foo.js')).toMatchObject({ stale: true, reason: 'crc-mismatch' })
    })
  })

  test('foreign: docPath існує без docgen-frontmatter (рукописна дока) → stale:false, foreign:true', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'npm', 'docs'))
      await writeFile(join(root, 'npm', 'index.js'), 'export const x = 1\n')
      // Людський зміст без frontmatter — живий кейс тихого перезапису (issue #16).
      await writeFile(join(root, 'npm', 'docs', 'index.md'), '# Nitra MT — документація\n\nЗміст.\n')

      expect(describeFile(root, 'npm/index.js')).toMatchObject({ stale: false, reason: null, foreign: true })
    })
  })

  test('foreign: frontmatter без docgen-CRC (OKF-дока людини) → теж foreign, не stale', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'foo.js'), 'export const a = 1\n')
      await writeFile(join(root, 'src', 'docs', 'foo.md'), '---\ntitle: Foo\nresource: src/foo.js\n---\n\n# Foo\n')

      expect(describeFile(root, 'src/foo.js')).toMatchObject({ stale: false, foreign: true })
    })
  })

  test('docgen-дока (є CRC) → foreign:false, CRC-семантика незмінна', async () => {
    await withTmpDir(async root => {
      const body = 'export const a = 1\n'
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'foo.js'), body)
      await writeFile(join(root, 'src', 'docs', 'foo.md'), stampDoc('## Огляд\n', 'src/foo.js', crc32(body)))

      expect(describeFile(root, 'src/foo.js')).toMatchObject({ stale: false, foreign: false })
    })
  })

  test('поважає .gitignore: ignored-файл випадає, решта лишається', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'keep.js'), 'export const k = 1\n')
      await writeFile(join(root, 'src', 'build.js'), 'export const b = 1\n')
      await writeFile(join(root, '.gitignore'), 'src/build.js\n')
      execFileSync('git', ['init', '-q'], { cwd: root })

      const paths = scanForDocFiles(root).map(i => i.sourcePath)
      expect(paths).toContain('src/keep.js')
      expect(paths).not.toContain('src/build.js')
    })
  })
})

describe('scanOrphanedDocs', () => {
  test('source видалено → orphan знайдено', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(
        join(root, 'src', 'docs', 'ghost.md'),
        stampDoc('## Огляд\n\nтест\n', 'src/ghost.mjs', 'deadbeef')
      )
      // src/ghost.mjs не існує → orphan
      expect(scanOrphanedDocs(root)).toEqual(['src/docs/ghost.md'])
    })
  })

  test('source існує → не orphan', async () => {
    await withTmpDir(async root => {
      const body = 'export const a = 1\n'
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(join(root, 'src', 'a.mjs'), body)
      await writeFile(join(root, 'src', 'docs', 'a.md'), stampDoc('## Огляд\n\nтест\n', 'src/a.mjs', crc32(body)))
      expect(scanOrphanedDocs(root)).toEqual([])
    })
  })

  test('Directory Index (resource із /) → не orphan', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src', 'docs'))
      await writeFile(
        join(root, 'src', 'docs', 'index.md'),
        '---\ntype: Directory Index\ntitle: src\nresource: src/\n---\n\n# src\n'
      )
      expect(scanOrphanedDocs(root)).toEqual([])
    })
  })

  test('ручна дока без CRC → не orphan', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src', 'docs'))
      // resource є, але немає docgen.crc → не від fix-doc-files → пропускаємо
      await writeFile(
        join(root, 'src', 'docs', 'notes.md'),
        '---\ntitle: Notes\nresource: src/notes.mjs\n---\n\n# Notes\n'
      )
      expect(scanOrphanedDocs(root)).toEqual([])
    })
  })

  test('docs/ у node_modules ігнорується', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'node_modules', 'pkg', 'docs'))
      await writeFile(
        join(root, 'node_modules', 'pkg', 'docs', 'foo.md'),
        stampDoc('## Огляд\n', 'node_modules/pkg/foo.mjs', 'deadbeef')
      )
      expect(scanOrphanedDocs(root)).toEqual([])
    })
  })
})
