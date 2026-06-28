import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  QUALITY_THRESHOLD,
  buildDocFrontmatter,
  crc32,
  parseDocFrontmatter,
  readDocCrc,
  readDocModel,
  readDocQuality,
  staleness,
  stampDoc
} from '../docgen-crc.mjs'

const HEX8_RE = /^[0-9a-f]{8}$/u

describe('crc32', () => {
  test('детермінований, 8-символьний hex', () => {
    const a = crc32('export const a = 1\n')
    expect(a).toMatch(HEX8_RE)
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
  test('buildDocFrontmatter → парситься назад (без quality — score:null)', () => {
    const fm = buildDocFrontmatter('src/lib/foo.js', 'a3f1c9e0')
    const { data, body } = parseDocFrontmatter(`${fm}\n## Огляд\n`)
    expect(data).toEqual({
      source: 'src/lib/foo.js',
      crc: 'a3f1c9e0',
      model: null,
      score: null,
      issues: [],
      judgeModel: null
    })
    expect(body.trim()).toBe('## Огляд')
  })

  test('model: повний id пишеться після crc і парситься назад', () => {
    const fm = buildDocFrontmatter('src/foo.js', 'a3f1c9e0', null, 'omlx/gemma-4-e4b-it-OptiQ-4bit')
    expect(fm).toMatch(/crc: a3f1c9e0\n {2}model: omlx\/gemma-4-e4b-it-OptiQ-4bit/u)
    expect(parseDocFrontmatter(fm).data.model).toBe('omlx/gemma-4-e4b-it-OptiQ-4bit')
  })

  test('model: відсутній аргумент → поля model немає, парситься як null', () => {
    const fm = buildDocFrontmatter('src/foo.js', 'a3f1c9e0')
    expect(fm).not.toContain('model:')
    expect(parseDocFrontmatter(fm).data.model).toBeNull()
  })

  test('model співіснує з quality: обидва пишуться і парсяться', () => {
    const fm = buildDocFrontmatter('src/foo.js', 'a3f1c9e0', { score: 55, issues: ['short-behavior'] }, 'omlx/m')
    const { data } = parseDocFrontmatter(fm)
    expect(data).toMatchObject({ model: 'omlx/m', score: 55, issues: ['short-behavior'] })
  })

  test('quality: score+issues пишуться і парсяться назад', () => {
    const fm = buildDocFrontmatter('src/foo.js', 'a3f1c9e0', {
      score: 55,
      issues: ['short-behavior', 'internal-name:bar']
    })
    const { data } = parseDocFrontmatter(fm)
    expect(data.score).toBe(55)
    expect(data.issues).toEqual(['short-behavior', 'internal-name:bar'])
  })

  test('quality: issues нормалізуються до кодів (зріз по пробілу, стеля 8)', () => {
    const many = Array.from({ length: 12 }, (_, i) => `code-${i} людський хвіст помилки`)
    const fm = buildDocFrontmatter('src/foo.js', 'a3f1c9e0', { score: 10, issues: many })
    const { data } = parseDocFrontmatter(fm)
    expect(data.issues).toHaveLength(8)
    expect(data.issues[0]).toBe('code-0')
  })

  test('quality: score без issues → рядка issues немає', () => {
    const fm = buildDocFrontmatter('src/foo.js', 'a3f1c9e0', { score: 90 })
    expect(fm).toContain('score: 90')
    expect(fm).not.toContain('issues:')
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

  test('stampDoc з quality несе degraded-маркер; без quality — знімає його', () => {
    const degraded = stampDoc('## Огляд\nтекст\n', 'src/foo.js', 'deadbeef', { score: 40, issues: ['no-overview'] })
    expect(parseDocFrontmatter(degraded).data).toMatchObject({ score: 40, issues: ['no-overview'] })
    const fresh = stampDoc(degraded, 'src/foo.js', 'feedface')
    expect(parseDocFrontmatter(fresh).data.score).toBeNull()
  })

  test('stampDoc проносить model у свіжий frontmatter', () => {
    const re = stampDoc('## Огляд\n', 'src/foo.js', 'deadbeef', null, 'omlx/m')
    expect(parseDocFrontmatter(re).data.model).toBe('omlx/m')
  })
})

describe('readDocModel', () => {
  test('читає model; null для відсутньої доки чи доки без поля', async () => {
    await withTmpDir(async root => {
      expect(readDocModel(join(root, 'absent.md'))).toBeNull()

      const plain = join(root, 'plain.md')
      await writeFile(plain, stampDoc('## Огляд\n', 'src/a.js', 'deadbeef'))
      expect(readDocModel(plain)).toBeNull()

      const withModel = join(root, 'with-model.md')
      await writeFile(withModel, stampDoc('## Огляд\n', 'src/b.js', 'deadbeef', null, 'omlx/gemma'))
      expect(readDocModel(withModel)).toBe('omlx/gemma')
    })
  })
})

describe('readDocQuality / QUALITY_THRESHOLD', () => {
  test('дефолтний поріг — 70', () => {
    expect(QUALITY_THRESHOLD).toBe(70)
  })

  test('читає score/issues; null для відсутньої доки чи доки без score', async () => {
    await withTmpDir(async root => {
      expect(readDocQuality(join(root, 'absent.md'))).toEqual({
        score: null,
        issues: [],
        judgeModel: null
      })

      const plain = join(root, 'plain.md')
      await writeFile(plain, stampDoc('## Огляд\n', 'src/a.js', 'deadbeef'))

      const degraded = join(root, 'degraded.md')
      await writeFile(
        degraded,
        stampDoc('## Огляд\n', 'src/b.js', 'deadbeef', { score: 55, issues: ['short-behavior'] })
      )
      expect(readDocQuality(degraded)).toEqual({
        score: 55,
        issues: ['short-behavior'],
        judgeModel: null
      })
    })
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
