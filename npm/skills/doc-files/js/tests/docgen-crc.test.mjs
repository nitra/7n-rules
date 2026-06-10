import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import { crc32, parseDocFrontmatter, buildDocFrontmatter, stampDoc, readDocCrc, staleness } from '../docgen-crc.mjs'

describe('crc32', () => {
  test('детермінований, 8-символьний hex', () => {
    const a = crc32('export const a = 1\n')
    expect(a).toMatch(/^[0-9a-f]{8}$/u)
    expect(crc32('export const a = 1\n')).toBe(a)
  })

  test('різний вміст → різний CRC; той самий — однаковий для рядка і Buffer', () => {
    expect(crc32('a')).not.toBe(crc32('b'))
    expect(crc32('hello')).toBe(crc32(Buffer.from('hello', 'utf8')))
  })

  test('відомий вектор: CRC32 "123456789" = cbf43926', () => {
    expect(crc32('123456789')).toBe('cbf43926')
  })
})

describe('frontmatter', () => {
  test('buildDocFrontmatter → парситься назад', () => {
    const fm = buildDocFrontmatter('src/lib/foo.js', 'a3f1c9e0')
    const { data, body } = parseDocFrontmatter(`${fm}\n## Огляд\n`)
    expect(data).toEqual({ source: 'src/lib/foo.js', crc: 'a3f1c9e0' })
    expect(body.trim()).toBe('## Огляд')
  })

  test('без frontmatter → data:null, тіло без змін', () => {
    const { data, body } = parseDocFrontmatter('## Огляд\nтекст\n')
    expect(data).toBeNull()
    expect(body).toBe('## Огляд\nтекст\n')
  })

  test('stampDoc знімає наявний frontmatter і додає свіжий', () => {
    const md = `${buildDocFrontmatter('src/foo.js', 'deadbeef')}\n## Огляд\nстаре\n`
    const re = stampDoc(md, 'src/foo.js', 'feedface')
    const { data, body } = parseDocFrontmatter(re)
    expect(data.crc).toBe('feedface')
    expect(body).toContain('## Огляд')
    expect(re.match(/^---/gmu)).toHaveLength(2) // рівно один frontmatter-блок
  })
})

describe('readDocCrc / staleness', () => {
  test('readDocCrc: null коли доки нема або без CRC', async () => {
    await withTmpDir(async root => {
      expect(readDocCrc(join(root, 'absent.md'))).toBeNull()
      await writeFile(join(root, 'plain.md'), '## Огляд\n')
      expect(readDocCrc(join(root, 'plain.md'))).toBeNull()
    })
  })

  test('staleness: missing → доки нема; crc-mismatch → джерело змінилось; свіже → збіг', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs'))
      const src = join(root, 'foo.js')
      const doc = join(root, 'docs', 'foo.md')
      await writeFile(src, 'export const a = 1\n')

      expect(staleness(src, doc)).toEqual({ stale: true, reason: 'missing' })

      await writeFile(doc, stampDoc('## Огляд\n', 'foo.js', crc32('export const a = 1\n')))
      expect(staleness(src, doc)).toEqual({ stale: false, reason: null })

      await writeFile(src, 'export const a = 2\n')
      expect(staleness(src, doc)).toEqual({ stale: true, reason: 'crc-mismatch' })
    })
  })
})
