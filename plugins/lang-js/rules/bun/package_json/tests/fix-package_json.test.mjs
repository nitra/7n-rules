/**
 * Характеризаційний гейт T0-фікса концерну `bun/package_json`
 * (`fix-package_json.mjs`) — єдиного й ПОСТІЙНОГО виконавця свого фіксу
 * (§2.92 `docs/plans/2026-08-05-open-questions-register.md`). Концерн свідомо
 * НЕ портується у wasm-гість, і блокер саме в ТИПІ межі: `source-file.content`
 * — `string`, а семантика фіксу вимагає бачити все дерево, тож глоб «усе
 * дерево» як `fix-glob` неможливий (сам патерн тут не пишу — його хвіст
 * закрив би цей блоковий коментар).
 * 124 MiB на виклик — не блокер, а ціна, яку той тип
 * виставив би, якби його все-таки взяли.
 *
 * Канонічний рядок, який фікс пише у ЧУЖІ файли, — `bunx n-rules lint
 * <surface>`. Зріз 6 (§12 `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`,
 * робота Д4) знімає npm-канал і замінює його на `n-rules lint <surface>`;
 * очікування нижче доведеться міняти разом із каноном, не окремо.
 *
 * До цього файлу фіксер мав НУЛЬ тестів, хоча пише у ЧУЖІ файли репозиторію
 * консюмера (workflow yml, вкладені package.json). Тести знімають поведінку
 * чотирьох дефектів, зафіксованих §2.92:
 *   1. асиметричний half-apply (`removed.length === 0` — чужі workflow вже
 *      переписані, мутація `pkg.scripts` викинута);
 *   2. `adaptUsages` пише на диск ДО зʼясування резолвності скрипта;
 *   3. мовчазний `readDenyTemplate` → `{}` (відсутній/побитий шаблон = фікс
 *      тихо нічого не деньїть);
 *   4. `JSON.stringify(pkg, null, 2)` губить форматування цільового файлу.
 *
 * Усі сценарії — виключно в `withTmpDir`; репо `7n-rules` тут не зачіпається.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { patterns } from '../fix-package_json.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const [stripDeniedPattern] = patterns
const CONCERN_DIR = join(import.meta.dirname, '..')

/**
 * Пише файл у тимчасове дерево, створюючи проміжні теки.
 * @param {string} root корінь тимчасового репо
 * @param {string} rel відносний posix-шлях
 * @param {string} content вміст
 * @returns {Promise<void>} завершення запису
 */
async function write(root, rel, content) {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Читає файл тимчасового дерева.
 * @param {string} root корінь тимчасового репо
 * @param {string} rel відносний posix-шлях
 * @returns {Promise<string>} вміст
 */
const read = (root, rel) => readFile(join(root, rel), 'utf8')

/**
 * Канонічний ctx T0-фікса з реальним `concernDir` концерну.
 * @param {string} dir корінь тимчасового репо
 * @param {object} [extra] перевизначення полів ctx
 * @returns {object} ctx для `apply()`
 */
const ctxFor = (dir, extra = {}) => ({
  cwd: dir,
  ruleId: 'bun',
  concernId: 'package_json',
  concernDir: CONCERN_DIR,
  recordWrite: () => {},
  ...extra
})

/** Порушення, що вмикає патерн (`test()` вимагає reason=policy-deny + file). */
const VIOLATIONS = [{ reason: 'policy-deny', file: 'package.json', message: 'заборонене поле' }]

describe('test()', () => {
  test('вмикається лише на policy-deny з file', () => {
    expect(stripDeniedPattern.test(VIOLATIONS)).toBe(true)
    expect(stripDeniedPattern.test([{ reason: 'policy-deny' }])).toBe(false)
    expect(stripDeniedPattern.test([{ reason: 'layout', file: 'package.json' }])).toBe(false)
    expect(stripDeniedPattern.test([])).toBe(false)
  })
})

describe('щасливий шлях (якір теперішньої коректної поведінки)', () => {
  test('видаляє deny-поля й lint-скрипт, переписавши його виклик у workflow', async () => {
    await withTmpDir(async dir => {
      await write(
        dir,
        'package.json',
        `${JSON.stringify(
          { name: 'x', packageManager: 'bun@1.2.0', scripts: { 'lint-js': 'eslint .', test: 'bun test' } },
          null,
          2
        )}\n`
      )
      await write(dir, '.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - run: bun run lint-js\n')

      const res = await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      const pkg = JSON.parse(await read(dir, 'package.json'))
      expect(pkg.packageManager).toBeUndefined()
      expect(pkg.scripts['lint-js']).toBeUndefined()
      expect(pkg.scripts.test).toBe('bun test')
      expect(await read(dir, '.github/workflows/ci.yml')).toContain('bunx n-rules lint js --no-fix')
      expect(res.touchedFiles.length).toBeGreaterThan(0)
    })
  })

  test('адаптує виклик у сусідньому скрипті ТОГО Ж package.json', async () => {
    await withTmpDir(async dir => {
      await write(
        dir,
        'package.json',
        `${JSON.stringify(
          {
            name: 'x',
            dependencies: { a: '1' },
            scripts: { 'lint-js': 'eslint .', precommit: 'bun run lint-js && bun test' }
          },
          null,
          2
        )}\n`
      )

      await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      const pkg = JSON.parse(await read(dir, 'package.json'))
      expect(pkg.dependencies).toBeUndefined()
      expect(pkg.scripts['lint-js']).toBeUndefined()
      expect(pkg.scripts.precommit).toBe('bunx n-rules lint js && bun test')
    })
  })
})

describe('дефект 1: асиметричний half-apply при removed.length === 0', () => {
  test('нерозпізнаний виклик у Makefile → НІЧОГО не записано на диск', async () => {
    await withTmpDir(async dir => {
      const pkgSource = `${JSON.stringify(
        { name: 'x', scripts: { 'lint-js': 'eslint .', precommit: 'bun run lint-js && bun test' } },
        null,
        2
      )}\n`
      const workflowSource = 'jobs:\n  a:\n    steps:\n      - run: bun run lint-js\n'
      await write(dir, 'package.json', pkgSource)
      await write(dir, '.github/workflows/ci.yml', workflowSource)
      // `other`-формат: виклик детектується, але canonical-заміщення немає →
      // скрипт НЕ видаляється, отже removed = [] і package.json не пишеться.
      await write(dir, 'Makefile', 'lint:\n\tbun run lint-js\n')

      const res = await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      // package.json не змінено — це поточна (правильна) частина поведінки.
      expect(await read(dir, 'package.json')).toBe(pkgSource)
      // …а чужий workflow має лишитись НЕЗАЙМАНИМ: видалення не сталось,
      // отже переписувати CI консюмера не було за що.
      expect(await read(dir, '.github/workflows/ci.yml')).toBe(workflowSource)
      expect(res.touchedFiles).toEqual([])
    })
  })

  test('recordWrite не викликається, коли жодного ключа не видалено', async () => {
    await withTmpDir(async dir => {
      await write(dir, 'package.json', `${JSON.stringify({ name: 'x', scripts: { lint: 'eslint .' } }, null, 2)}\n`)
      await write(dir, '.github/workflows/ci.yml', 'steps:\n  - run: bun run lint\n')
      await write(dir, 'Makefile', 'all:\n\tbun run lint\n')

      const written = []
      await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir, { recordWrite: p => written.push(p) }))

      expect(written).toEqual([])
    })
  })
})

describe('дефект 2: виклики переписані ДО зʼясування резолвності', () => {
  test('deny-поле видаляється, але workflow заблокованого скрипта не чіпається', async () => {
    await withTmpDir(async dir => {
      await write(
        dir,
        'package.json',
        `${JSON.stringify({ name: 'x', packageManager: 'bun@1.2.0', scripts: { 'lint-js': 'eslint .' } }, null, 2)}\n`
      )
      const workflowSource = 'jobs:\n  a:\n    steps:\n      - run: bun run lint-js\n'
      await write(dir, '.github/workflows/ci.yml', workflowSource)
      await write(dir, 'Makefile', 'lint:\n\tbun run lint-js\n')

      const res = await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      const pkg = JSON.parse(await read(dir, 'package.json'))
      // deny-поле — незалежна від скриптів дія, вона МАЄ статись.
      expect(pkg.packageManager).toBeUndefined()
      // Скрипт лишається (заблокований Makefile-ом) — отже його виклик у CI
      // консюмера переписувати НЕ можна.
      expect(pkg.scripts['lint-js']).toBe('eslint .')
      expect(await read(dir, '.github/workflows/ci.yml')).toBe(workflowSource)
      expect(res.touchedFiles).toEqual([join(dir, 'package.json')])
    })
  })

  test('вкладений package.json заблокованого скрипта теж не переписується', async () => {
    await withTmpDir(async dir => {
      await write(
        dir,
        'package.json',
        `${JSON.stringify(
          { name: 'root', packageManager: 'bun@1.2.0', scripts: { 'lint-css': 'stylelint .' } },
          null,
          2
        )}\n`
      )
      const nestedSource = `${JSON.stringify({ name: 'nested', scripts: { ci: 'bun run lint-css' } }, null, 2)}\n`
      await write(dir, 'packages/ui/package.json', nestedSource)
      await write(dir, 'run.sh', '#!/bin/sh\nbun run lint-css\n')

      await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      expect(await read(dir, 'packages/ui/package.json')).toBe(nestedSource)
    })
  })
})

describe('дефект 3: мовчазний readDenyTemplate → {}', () => {
  test('відсутній template — гучна відмова, а не тихий no-op', async () => {
    await withTmpDir(async dir => {
      await write(dir, 'package.json', `${JSON.stringify({ name: 'x', packageManager: 'bun@1.2.0' }, null, 2)}\n`)

      await expect(stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir, { concernDir: dir }))).rejects.toThrow(
        /deny-template/u
      )
    })
  })

  test('побитий JSON template — гучна відмова', async () => {
    await withTmpDir(async dir => {
      await write(dir, 'package.json', `${JSON.stringify({ name: 'x', packageManager: 'bun@1.2.0' }, null, 2)}\n`)
      await write(dir, 'fake-concern/template/package.json.deny.json', '{ broken')

      await expect(
        stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir, { concernDir: join(dir, 'fake-concern') }))
      ).rejects.toThrow(/deny-template/u)
    })
  })

  test('ctx без concernDir — гучна відмова', async () => {
    await withTmpDir(async dir => {
      await write(dir, 'package.json', `${JSON.stringify({ name: 'x', packageManager: 'bun@1.2.0' }, null, 2)}\n`)

      await expect(stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir, { concernDir: undefined }))).rejects.toThrow(
        /deny-template/u
      )
    })
  })
})

describe('дефект 4: форматування цільового package.json', () => {
  test('зберігає 4-пробільний відступ', async () => {
    await withTmpDir(async dir => {
      await write(
        dir,
        'package.json',
        `${JSON.stringify({ name: 'x', packageManager: 'bun@1.2.0', scripts: { test: 'bun test' } }, null, 4)}\n`
      )

      await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      const raw = await read(dir, 'package.json')
      expect(raw).toContain('\n    "name"')
      expect(raw).not.toContain('\n  "name"')
    })
  })

  test('зберігає табуляцію й відсутність кінцевого переводу рядка', async () => {
    await withTmpDir(async dir => {
      await write(
        dir,
        'package.json',
        JSON.stringify({ name: 'x', packageManager: 'bun@1.2.0', scripts: { test: 'bun test' } }, null, '\t')
      )

      await stripDeniedPattern.apply(VIOLATIONS, ctxFor(dir))

      const raw = await read(dir, 'package.json')
      expect(raw).toContain('\n\t"name"')
      expect(raw.endsWith('}')).toBe(true)
    })
  })
})
