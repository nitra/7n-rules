/**
 * Характеризаційний гейт JS-канону `fix-layout.mjs` (три патерни:
 * `rm-forbidden-file`/`bun-bunfig-create`/`bun-yarn-dir-remove`) —
 * знятий ПЕРЕД портом у wasm-гість `crates/plugin-lang-js` (концерн
 * `bun/layout`, `scope: full`), щоб мати зелений якір теперішньої
 * поведінки, якого раніше не було (`git ls-files` не показував жодного
 * тесту цього фіксера). Усі сценарії — лише в `withTmpDir` (репо
 * `7n-rules` жодним тестом тут не зачіпається).
 */
import { describe, expect, test } from 'vitest'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { patterns } from '../fix-layout.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const [rmForbiddenFile, bunfigCreate, yarnDirRemove] = patterns

const exists = async p => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('rm-forbidden-file pattern', () => {
  test('test: true лише коли message матчить "Знайдено заборонений файл: …"', () => {
    expect(
      rmForbiddenFile.test([{ reason: 'layout', message: 'Знайдено заборонений файл: yarn.lock — видали його' }])
    ).toBe(true)
    expect(rmForbiddenFile.test([{ reason: 'layout', message: 'Відсутній bunfig.toml — створи …' }])).toBe(false)
    expect(rmForbiddenFile.test([])).toBe(false)
  })

  test('apply: видаляє РІВНО заборонені файли з диска, ігноруючи не-матчі', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'yarn.lock'), '# yarn\n', 'utf8')
      await writeFile(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6\n', 'utf8')
      await writeFile(join(dir, 'bun.lock'), '{}\n', 'utf8')

      const violations = [
        { reason: 'layout', message: 'Знайдено заборонений файл: yarn.lock — видали його' },
        { reason: 'layout', message: 'Знайдено заборонений файл: pnpm-lock.yaml — видали його' },
        { reason: 'layout', message: 'Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)' }
      ]
      const res = await rmForbiddenFile.apply(violations, { cwd: dir })

      expect(res.touchedFiles).toEqual([join(dir, 'yarn.lock'), join(dir, 'pnpm-lock.yaml')])
      expect(await exists(join(dir, 'yarn.lock'))).toBe(false)
      expect(await exists(join(dir, 'pnpm-lock.yaml'))).toBe(false)
      // bun.lock — не заборонений, не чіпаємо
      expect(await exists(join(dir, 'bun.lock'))).toBe(true)
    })
  })

  test('apply: файл із заборонним іменем, якого вже немає на диску — no-op, БЕЗ падіння', async () => {
    await withTmpDir(async dir => {
      const violations = [
        { reason: 'layout', message: 'Знайдено заборонений файл: package-lock.json — видали його' }
      ]
      const res = await rmForbiddenFile.apply(violations, { cwd: dir })
      expect(res.touchedFiles).toEqual([])
      expect(res.message).toBeUndefined()
    })
  })

  test('apply: violation без матчу FORBIDDEN_FILE_NAME_RE (текст не збігається) — пропускається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'yarn.lock'), '# yarn\n', 'utf8')
      const violations = [{ reason: 'layout', message: 'якийсь інший текст без потрібної форми' }]
      const res = await rmForbiddenFile.apply(violations, { cwd: dir })
      expect(res.touchedFiles).toEqual([])
      expect(await exists(join(dir, 'yarn.lock'))).toBe(true)
    })
  })
})

describe('bun-bunfig-create pattern', () => {
  test('test: true лише коли message матчить "Відсутній bunfig.toml"', () => {
    expect(bunfigCreate.test([{ reason: 'layout', message: 'Відсутній bunfig.toml — створи …' }])).toBe(true)
    expect(
      bunfigCreate.test([{ reason: 'layout', message: 'Знайдено заборонений файл: yarn.lock — видали його' }])
    ).toBe(false)
    expect(bunfigCreate.test([])).toBe(false)
  })

  test('apply: створює bunfig.toml з канонічним вмістом, коли файла немає', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'layout', message: 'Відсутній bunfig.toml — створи …' }]
      const res = await bunfigCreate.apply(violations, { cwd: dir })

      const target = join(dir, 'bunfig.toml')
      expect(res.touchedFiles).toEqual([target])
      expect(await readFile(target, 'utf8')).toBe('[install]\nlinker = "hoisted"\n')
    })
  })

  test('apply: bunfig.toml вже існує — НЕ перезаписує чужий вміст', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, 'bunfig.toml')
      await writeFile(target, '[install]\nlinker = "isolated"\n# custom\n', 'utf8')

      const violations = [{ reason: 'layout', message: 'Відсутній bunfig.toml — створи …' }]
      const res = await bunfigCreate.apply(violations, { cwd: dir })

      expect(res.touchedFiles).toEqual([])
      expect(await readFile(target, 'utf8')).toBe('[install]\nlinker = "isolated"\n# custom\n')
    })
  })
})

describe('bun-yarn-dir-remove pattern', () => {
  test('test: true лише коли message матчить "Знайдено директорію .yarn"', () => {
    expect(yarnDirRemove.test([{ reason: 'layout', message: 'Знайдено директорію .yarn — видали її' }])).toBe(true)
    expect(yarnDirRemove.test([{ reason: 'layout', message: 'Відсутній bunfig.toml — створи …' }])).toBe(false)
    expect(yarnDirRemove.test([])).toBe(false)
  })

  test('apply: видаляє .yarn/ разом із вкладеним вмістом', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.yarn', 'releases'), { recursive: true })
      await writeFile(join(dir, '.yarn', 'releases', 'yarn-4.0.0.cjs'), '// yarn\n', 'utf8')
      await writeFile(join(dir, '.yarn', 'install-state.gz'), 'binary', 'utf8')

      const violations = [{ reason: 'layout', message: 'Знайдено директорію .yarn — видали її' }]
      const res = await yarnDirRemove.apply(violations, { cwd: dir })

      const target = join(dir, '.yarn')
      expect(res.touchedFiles).toEqual([target])
      expect(await exists(target)).toBe(false)
    })
  })

  test('apply: .yarn відсутній на диску — no-op, БЕЗ падіння', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'layout', message: 'Знайдено директорію .yarn — видали її' }]
      const res = await yarnDirRemove.apply(violations, { cwd: dir })
      expect(res.touchedFiles).toEqual([])
    })
  })
})
