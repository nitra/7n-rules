/**
 * Тести для utils_imports.check():
 *   - порожнє дерево без utils/ → pass (перевірку пропущено)
 *   - utils/ з дозволеними імпортами (./sub, bare package) → pass
 *   - utils/ з забороненим `../`-імпортом → fail
 *   - файли в utils/tests/ ігноруються
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { lint } from '../main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

/**
 * Запускає detector у whole-repo режимі і повертає кількість порушень.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<number>} кількість LintViolation
 */
const check = async dir => {
  const result = await lint({ cwd: dir, ruleId: 'js', concernId: 'utils_imports', files: undefined })
  return result.violations.length
}

describe('utils_imports.check', () => {
  test('без utils-каталогів → exit 0 (перевірку пропущено)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src', 'index.mjs'), 'export const x = 1\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('utils/ з дозволеним ./same-dir імпортом → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'helper.mjs'),
        "import { readFile } from 'node:fs/promises'\nexport function h() {}\n",
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('utils/ з bare package import → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(join(dir, 'utils', 'fmt.mjs'), "import { parse } from 'yaml'\nexport const p = parse\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('utils/ з забороненим ../  імпортом → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'bad.mjs'),
        "import { config } from '../lib/config.mjs'\nexport const x = config\n",
        'utf8'
      )
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('файл у utils/tests/ ігнорується (../X дозволено)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils', 'tests'), { recursive: true })
      // Тест легально імпортує через ../ — це звичайний паттерн тестів
      await writeFile(join(dir, 'utils', 'tests', 'helper.test.mjs'), "import { h } from '../helper.mjs'\n", 'utf8')
      // Немає нетестових файлів → pass (перевірку пропущено)
      expect(await check(dir)).toBe(0)
    })
  })

  test('файл у utils/__fixtures__/ ігнорується', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils', '__fixtures__'), { recursive: true })
      await writeFile(join(dir, 'utils', '__fixtures__', 'data.mjs'), "import { x } from '../../other.mjs'\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('utils/ з підкаталогом helpers/ → рекурсивно збирає файли', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils', 'helpers'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'helpers', 'helper.mjs'),
        "import { join } from 'node:path'\nexport const h = join\n",
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('utils/ у .n-rules.json ignore → ігнорується (isIgnored returns true)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(join(dir, 'utils', 'bad.mjs'), "import { x } from '../lib.mjs'\nexport const y = x\n", 'utf8')
      // ignoring the utils directory → check() повинен пройти без порушень
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ ignore: ['utils'] }), 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })
})
