// cspell:ignore фронтматері хелоу — навмисні словникові фікстури: перевіряємо, що merge їх зберігає
/**
 * Поведінка T0-фікса `text/cspell` на temp-фікстурах.
 *
 * Фікс — native (`crates/rules-core/src/concerns/fix_cspell_config.rs`, §2.79);
 * JS-канон `fix-cspell.mjs` знято §2.89. Патерн береться з `loadT0Patterns` —
 * того самого резолвера, яким ходить прод (`run-fix.mjs`), а не з імпорту
 * канону: так ці кейси лишаються перевіркою РЕАЛЬНОГО виконавця `--fix`.
 *
 * Одна свідома різниця форми проти канону: `test()` native-патерну — це «план
 * для цих violations непорожній» (доккомент `nativeFixPattern`), а не окремий
 * предикат по `reason`. Предикатний кейс нижче тому подає ще й стан диска
 * (порожній tmp-корінь: `.cspell.json` відсутній, тож для «своїх» reason-ів
 * план непорожній, а для стороннього — порожній).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'

/** Реальна тека концерну `text/cspell` (її `template/` — джерело, яке native `include_str!`-ить). */
const CONCERN_DIR = fileURLToPath(new URL('..', import.meta.url))

/**
 * Резолвить T0-патерн концерну так само, як прод, і вимагає РІВНО одного native.
 * @param {string} root tmp-корінь як cwd
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').T0Pattern>} єдиний патерн концерну
 */
async function patternFor(root) {
  const patterns = await loadT0Patterns(CONCERN_DIR, 'cspell', 'text', root)
  // Нуль патернів = `--fix` МОВЧКИ перестав фіксити концерн (§2.89): падаємо голосно.
  expect(patterns).toHaveLength(1)
  expect(patterns[0].id).toBe('native-fix:text/cspell')
  return patterns[0]
}

/** Канонічні ignorePaths зі snippet — для перевірки, що merge їх дописав. */
const SNIPPET_IGNORE = JSON.parse(
  await readFile(join(CONCERN_DIR, 'template', '.cspell.json.snippet.json'), 'utf8')
).ignorePaths

/**
 * Фабрики violations: НОВИЙ масив на кожен виклик — native-план кешується у
 * `WeakMap` за identity масиву (`nativeFixPlanCache`, `run-fix.mjs`), тож
 * спільний літерал між кейсами віддавав би план попереднього дерева.
 * @param {string} reason причина порушення
 * @returns {object[]} масив з однієї violation у формі, яку приймає napi-міст
 */
const v = reason => [{ ruleId: 'text', concernId: 'cspell', reason, message: 'm', file: '.cspell.json' }]
const deny = () => v('policy-deny')
const missing = () => v('policy-file-missing')
const other = () => v('other')

/** Мінімальний FixContext: T0 — permanent-фаза, запис не відстежується. */
const ctx = {
  recordWrite() {
    // навмисний no-op
  }
}

describe('text/cspell T0 (native cspell-merge)', () => {
  test('test(): реагує на policy-file-missing та policy-deny, і не на сторонній reason', async () => {
    await withTmpDir(async root => {
      const pattern = await patternFor(root)
      expect(pattern.test(deny())).toBe(true)
      expect(pattern.test(missing())).toBe(true)
      expect(pattern.test(other())).toBe(false)
    })
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

      const pattern = await patternFor(root)
      const res = await pattern.apply(deny(), ctx)
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
      const pattern = await patternFor(root)
      const res = await pattern.apply(missing(), ctx)
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
        gitignoreRoot: '.',
        ignorePaths: [...SNIPPET_IGNORE, 'target/**'],
        import: ['@nitra/cspell-dict/cspell-ext.json'],
        words: ['омлх']
      }
      const raw = JSON.stringify(canonical)
      await writeFile(join(root, '.cspell.json'), raw)

      const pattern = await patternFor(root)
      const res = await pattern.apply(deny(), ctx)
      expect(res.touchedFiles).toEqual([])
      expect(await readFile(join(root, '.cspell.json'), 'utf8')).toBe(raw) // байт-у-байт незмінний
    })
  })

  test('невалідний JSON → не чіпаємо (без мовчазного перезапису)', async () => {
    await withTmpDir(async root => {
      await writeFile(join(root, '.cspell.json'), '{ broken')
      const pattern = await patternFor(root)
      const res = await pattern.apply(deny(), ctx)
      expect(res.touchedFiles).toEqual([])
      expect(await readFile(join(root, '.cspell.json'), 'utf8')).toBe('{ broken')
    })
  })
})
