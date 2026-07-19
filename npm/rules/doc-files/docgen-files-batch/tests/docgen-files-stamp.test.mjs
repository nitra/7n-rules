/**
 * Інтеграційний тест `doc-files stamp` (runDocFilesStampCli) на реальній ФС:
 * перештампування frontmatter НЕ має губити поля `tier`, `judgeModel`, `model`,
 * `score`/`issues`, а `crc` має оновитись до CRC поточного джерела.
 * Регресія: stamp раніше прокидав у stampDoc лише score/issues/model —
 * `tier:` і `judgeModel:` зникали з усіх док, яких торкнувся прогін.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runDocFilesStampCli } from '../main.mjs'
import { crc32, readDocCrc, readDocModel, readDocQuality, readDocTier, stampDoc } from '../../docgen-crc/main.mjs'

/** @type {string[]} */
const tmpRoots = []

/**
 * Створює tmp-корінь із джерелом `src/foo.mjs` та докою `src/docs/foo.md`,
 * frontmatter якої вже містить model/tier/score/issues/judgeModel і застарілий CRC.
 * @returns {{ root: string, docAbs: string }} корінь і абсолютний шлях доки
 */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'docgen-stamp-'))
  tmpRoots.push(root)
  // Фейковий lang-js: після фази 5b .mjs — кандидат лише з активним плагіном.
  const pluginRoot = join(root, 'node_modules', '@7n', 'rules-lang-js')
  mkdirSync(pluginRoot, { recursive: true })
  writeFileSync(
    join(pluginRoot, 'package.json'),
    JSON.stringify({
      name: '@7n/rules-lang-js',
      'n-rules': { contributes: { rules: false, docFiles: { extensions: { '.mjs': 'JS Module' } } } }
    })
  )
  writeFileSync(join(root, '.n-rules.json'), JSON.stringify({ plugins: ['@7n/rules-lang-js'] }))
  mkdirSync(join(root, 'src', 'docs'), { recursive: true })
  writeFileSync(join(root, 'src', 'foo.mjs'), 'export const x = 1\n')
  const docAbs = join(root, 'src', 'docs', 'foo.md')
  const md = stampDoc(
    '## Огляд\n\nТестова дока.\n',
    'src/foo.mjs',
    'deadbeef', // навмисно застарілий CRC — stamp має його оновити
    { score: 40, issues: ['too-short'], judge: { model: 'claude-haiku-4-5' } },
    'omlx/gemma3:4b',
    'local-min'
  )
  writeFileSync(docAbs, md)
  return { root, docAbs }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {
    // навмисний no-op: глушимо console.log у тесті
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('runDocFilesStampCli — збереження frontmatter-полів', () => {
  test('stamp оновлює crc і НЕ губить tier/judgeModel/model/score/issues', () => {
    const { root, docAbs } = makeFixture()

    expect(runDocFilesStampCli(['--root', root])).toBe(0)

    expect(readDocCrc(docAbs)).toBe(crc32(readFileSync(join(root, 'src', 'foo.mjs'))))
    expect(readDocTier(docAbs)).toBe('local-min')
    expect(readDocModel(docAbs)).toBe('omlx/gemma3:4b')
    expect(readDocQuality(docAbs)).toEqual({ score: 40, issues: ['too-short'], judgeModel: 'claude-haiku-4-5' })
  })

  test('stamp доки без quality-полів не вигадує їх і зберігає tier', () => {
    const { root, docAbs } = makeFixture()
    writeFileSync(docAbs, stampDoc('## Огляд\n', 'src/foo.mjs', 'deadbeef', null, null, 'cloud-avg'))

    expect(runDocFilesStampCli(['--root', root])).toBe(0)

    expect(readDocTier(docAbs)).toBe('cloud-avg')
    expect(readDocModel(docAbs)).toBeNull()
    expect(readDocQuality(docAbs)).toEqual({ score: null, issues: [], judgeModel: null })
  })
})
