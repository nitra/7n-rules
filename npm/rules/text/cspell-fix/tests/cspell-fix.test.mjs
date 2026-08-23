// cspell:ignore wrod — навмисний тайпо-фікстур для перевірки detectCspell/unknownWords
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { unknownWords, appendWordsToDict, detectCspell } from '../fix-worker.mjs'

const FILES_CHECKED_ZERO_RE = /Files checked:\s*0/u
const UNKNOWN_WORD_RE = /Unknown word/u

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

  // Тестовий cwd — ізольований tmp-каталог поза деревом репо (навмисно: перевіряємо
  // ignorePaths у вакуумі), тож `npx cspell` не бачить локальний `node_modules/cspell`
  // (ancestor-lookup npm exec шукає від cwd, а tmp-каталог поза цим деревом) і на
  // холодному npx-кеші (свіжий GitHub ubuntu-runner, кеша `~/.npm/_npx` ще нема)
  // реально тягне пакет з registry — довше за дефолтний vitest testTimeout=5000ms
  // (спостережено в CI: `Error: Test timed out in 5000ms`, run 30483522628). Другий
  // тест тут не мав такого падіння лише тому, що перший встиг прогріти кеш до свого
  // таймауту — не покладаємось на цей порядко-залежний побічний ефект, timeout
  // піднято симетрично для обох.
  const COLD_NPX_TIMEOUT = 30_000

  test(
    'файл повністю в ignorePaths (Files checked: 0) → code:0, не порушення',
    { timeout: COLD_NPX_TIMEOUT },
    async () => {
      if (!bin) return // npx недоступний у середовищі — пропускаємо
      await withTmpDir(async root => {
        await writeFile(join(root, '.cspell.json'), JSON.stringify({ version: '0.2', ignorePaths: ['**/*'] }))
        await writeFile(join(root, 'typo.md'), 'This is teh wrong wrod.')
        const result = await detectCspell(root, bin, ['typo.md'])
        expect(result.code).toBe(0)
        expect(result.out).toMatch(FILES_CHECKED_ZERO_RE)
      })
    }
  )

  test('реальні одруки в перевірених файлах → code!=0', { timeout: COLD_NPX_TIMEOUT }, async () => {
    if (!bin) return
    await withTmpDir(async root => {
      await writeFile(join(root, '.cspell.json'), JSON.stringify({ version: '0.2' }))
      await writeFile(join(root, 'typo.md'), 'This is teh wrong wrod.')
      const result = await detectCspell(root, bin, ['typo.md'])
      expect(result.code).not.toBe(0)
      expect(result.out).toMatch(UNKNOWN_WORD_RE)
    })
  })
})
