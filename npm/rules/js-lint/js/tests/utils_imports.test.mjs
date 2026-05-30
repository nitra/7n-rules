/**
 * Тести для utils_imports.check():
 *   - порожнє дерево без utils/ → pass (перевірку пропущено)
 *   - utils/ з дозволеними імпортами (./sub, bare package) → pass
 *   - utils/ з забороненим `../`-імпортом → fail
 *   - файли в utils/tests/ ігноруються
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { check } from '../utils_imports.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('utils_imports.check', () => {
  // Кожен test мокає process.cwd() → tmp dir
  let restoreCwd

  afterEach(() => {
    if (restoreCwd) {
      restoreCwd()
      restoreCwd = null
    }
  })

  test('без utils-каталогів → exit 0 (перевірку пропущено)', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src', 'index.mjs'), 'export const x = 1\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('utils/ з дозволеним ./same-dir імпортом → exit 0', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'helper.mjs'),
        "import { readFile } from 'node:fs/promises'\nexport function h() {}\n",
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('utils/ з bare package import → exit 0', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'fmt.mjs'),
        "import { parse } from 'yaml'\nexport const p = parse\n",
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('utils/ з забороненим ../  імпортом → exit 1', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'bad.mjs'),
        "import { config } from '../lib/config.mjs'\nexport const x = config\n",
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('файл у utils/tests/ ігнорується (../X дозволено)', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils', 'tests'), { recursive: true })
      // Тест легально імпортує через ../ — це звичайний паттерн тестів
      await writeFile(
        join(dir, 'utils', 'tests', 'helper.test.mjs'),
        "import { h } from '../helper.mjs'\n",
        'utf8'
      )
      // Немає нетестових файлів → pass (перевірку пропущено)
      expect(await check()).toBe(0)
    })
  })

  test('файл у utils/__fixtures__/ ігнорується', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils', '__fixtures__'), { recursive: true })
      await writeFile(
        join(dir, 'utils', '__fixtures__', 'data.mjs'),
        "import { x } from '../../other.mjs'\n",
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('utils/ з підкаталогом helpers/ → рекурсивно збирає файли', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils', 'helpers'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'helpers', 'helper.mjs'),
        "import { join } from 'node:path'\nexport const h = join\n",
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('utils/ у .n-cursor.json ignore → ігнорується (isIgnored returns true)', async () => {
    await withTmpDir(async dir => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      restoreCwd = () => spy.mockRestore()
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'bad.mjs'),
        "import { x } from '../lib.mjs'\nexport const y = x\n",
        'utf8'
      )
      // ignoring the utils directory → check() повинен пройти без порушень
      await writeFile(join(dir, '.n-cursor.json'), JSON.stringify({ ignore: ['utils'] }), 'utf8')
      expect(await check()).toBe(0)
    })
  })
})
