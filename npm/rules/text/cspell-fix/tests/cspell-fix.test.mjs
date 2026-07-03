import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { unknownWords, appendWordsToDict, detectCspell } from '../main.mjs'

describe('unknownWords', () => {
  test('витягує distinct-слова з виводу cspell', () => {
    const out = [
      'docs/a.md:3:5 - Unknown word (teh)',
      'docs/a.md:7:1 - Unknown word (quik)',
      'src/b.ts:10:2 - Unknown word (teh)', // дубль → один раз
      '1/1 files (no errors)' // не-finding рядок — ігнорувати
    ].join('\n')
    expect(unknownWords(out)).toEqual(['teh', 'quik'])
  })

  test('порожній вивід → []', () => {
    expect(unknownWords('')).toEqual([])
  })
})

describe('appendWordsToDict', () => {
  test('дописує нові слова у .cspell.json#words (sorted/dedup), повертає к-сть доданих', async () => {
    await withTmpDir(async root => {
      await writeFile(join(root, '.cspell.json'), JSON.stringify({ version: '0.2', words: ['omlx'] }))
      const added = appendWordsToDict(root, ['аддон', 'omlx', 'мапінг'])
      expect(added).toBe(2) // omlx уже був
      const cfg = JSON.parse(await readFile(join(root, '.cspell.json'), 'utf8'))
      expect(cfg.words).toEqual(['omlx', 'аддон', 'мапінг'].toSorted((a, b) => a.localeCompare(b)))
    })
  })

  test('порожній список або відсутній конфіг → 0', async () => {
    await withTmpDir(async root => {
      expect(appendWordsToDict(root, [])).toBe(0) // немає .cspell.json і слів
      await writeFile(join(root, '.cspell.json'), JSON.stringify({ version: '0.2' }))
      expect(appendWordsToDict(root, [])).toBe(0)
    })
  })
})

describe('detectCspell', () => {
  const bin = resolveCmd('npx')

  test('файл повністю в ignorePaths (Files checked: 0) → code:0, не порушення', async () => {
    if (!bin) return // npx недоступний у середовищі — пропускаємо
    await withTmpDir(async root => {
      await writeFile(join(root, '.cspell.json'), JSON.stringify({ version: '0.2', ignorePaths: ['**/*'] }))
      await writeFile(join(root, 'typo.md'), 'This is teh wrong wrod.')
      const result = detectCspell(root, bin, ['typo.md'])
      expect(result.code).toBe(0)
      expect(result.out).toMatch(/Files checked:\s*0/u)
    })
  })

  test('реальні одруки в перевірених файлах → code!=0', async () => {
    if (!bin) return
    await withTmpDir(async root => {
      await writeFile(join(root, '.cspell.json'), JSON.stringify({ version: '0.2' }))
      await writeFile(join(root, 'typo.md'), 'This is teh wrong wrod.')
      const result = detectCspell(root, bin, ['typo.md'])
      expect(result.code).not.toBe(0)
      expect(result.out).toMatch(/Unknown word/u)
    })
  })
})
