// cspell:ignore фронтматері хелоу — навмисні словникові фікстури: перевіряємо, що merge їх зберігає
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { patterns } from '../fix-cspell.mjs'

/** Реальна тека концерну `text/cspell` — T0 читає канон з її template/. */
const CONCERN_DIR = fileURLToPath(new URL('..', import.meta.url))

const [pattern] = patterns

/**
 * @param {string} root tmp-корінь як cwd
 * @returns {{cwd: string, ruleId: string, concernId: string, concernDir: string}} LintContext-подібний ctx для apply()
 */
const ctxFor = root => ({ cwd: root, ruleId: 'text', concernId: 'cspell', concernDir: CONCERN_DIR })

/** Канонічні ignorePaths зі snippet — для перевірки, що merge їх дописав. */
const SNIPPET_IGNORE = JSON.parse(
  await readFile(join(CONCERN_DIR, 'template', '.cspell.json.snippet.json'), 'utf8')
).ignorePaths

describe('fix-cspell T0 (cspell-merge)', () => {
  test('test(): реагує на policy-file-missing та policy-deny', () => {
    expect(pattern.test([{ reason: 'policy-deny' }])).toBe(true)
    expect(pattern.test([{ reason: 'policy-file-missing' }])).toBe(true)
    expect(pattern.test([{ reason: 'other' }])).toBe(false)
  })

  test('наявний конфіг з кастомними words+ignorePaths → після фіксу все збережено, канон дописано', async () => {
    await withTmpDir(async root => {
      const existing = {
        version: '0.1', // застарілий — має стати канонічним "0.2"
        language: 'en,uk,ru-ru,nitra', // кастомний — НЕ перезаписується (presence-only)
        ignorePaths: ['target/**', 'src-tauri/gen/**'], // repo-специфічні — зберігаються
        words: ['омлх', 'фронтматері', 'тернарник'],
        flagWords: ['хелоу'],
        overrides: [{ filename: '**/*.rs', languageId: 'rust' }] // стороннє поле — не чіпаємо
      }
      await writeFile(join(root, '.cspell.json'), JSON.stringify(existing))

      const res = await pattern.apply([{ reason: 'policy-deny' }], ctxFor(root))
      expect(res.touchedFiles).toEqual([join(root, '.cspell.json')])

      const cfg = JSON.parse(await readFile(join(root, '.cspell.json'), 'utf8'))
      expect(cfg.words).toEqual(existing.words) // нічого не зникло
      expect(cfg.flagWords).toEqual(existing.flagWords)
      expect(cfg.overrides).toEqual(existing.overrides)
      expect(cfg.language).toBe('en,uk,ru-ru,nitra')
      expect(cfg.version).toBe('0.2')
      // repo-специфічні glob-и попереду, канонічні дописані в кінець
      expect(cfg.ignorePaths.slice(0, 2)).toEqual(['target/**', 'src-tauri/gen/**'])
      for (const p of SNIPPET_IGNORE) expect(cfg.ignorePaths).toContain(p)
      expect(cfg.import.some(i => i.includes('@nitra/cspell-dict'))).toBe(true)
    })
  })

  test('відсутній .cspell.json → скаффолд зі snippet + import + language', async () => {
    await withTmpDir(async root => {
      const res = await pattern.apply([{ reason: 'policy-file-missing' }], ctxFor(root))
      expect(res.touchedFiles).toEqual([join(root, '.cspell.json')])

      const cfg = JSON.parse(await readFile(join(root, '.cspell.json'), 'utf8'))
      expect(cfg.version).toBe('0.2')
      expect(cfg.ignorePaths).toEqual(SNIPPET_IGNORE)
      expect(cfg.import.some(i => i.includes('@nitra/cspell-dict'))).toBe(true)
      expect(cfg.language).toBeTruthy()
    })
  })

  test('вже канонічний конфіг → без запису (ідемпотентність)', async () => {
    await withTmpDir(async root => {
      const canonical = {
        version: '0.2',
        language: 'en,uk',
        useGitignore: true,
        ignorePaths: [...SNIPPET_IGNORE, 'target/**'],
        import: ['@nitra/cspell-dict/cspell-ext.json'],
        words: ['омлх']
      }
      const raw = JSON.stringify(canonical)
      await writeFile(join(root, '.cspell.json'), raw)

      const res = await pattern.apply([{ reason: 'policy-deny' }], ctxFor(root))
      expect(res.touchedFiles).toEqual([])
      expect(await readFile(join(root, '.cspell.json'), 'utf8')).toBe(raw) // байт-у-байт незмінний
    })
  })

  test('невалідний JSON → не чіпаємо (без мовчазного перезапису)', async () => {
    await withTmpDir(async root => {
      await writeFile(join(root, '.cspell.json'), '{ broken')
      const res = await pattern.apply([{ reason: 'policy-deny' }], ctxFor(root))
      expect(res.touchedFiles).toEqual([])
      expect(await readFile(join(root, '.cspell.json'), 'utf8')).toBe('{ broken')
    })
  })
})
