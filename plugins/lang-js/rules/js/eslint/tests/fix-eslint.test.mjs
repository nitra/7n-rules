/**
 * Тести T0-codemod `fix-eslint.mjs`. Реальний прогін oxlint/eslint --fix зав'язаний на
 * зовнішні лінтери + конфіг репо (перевірено вручну + e2e); тут — контракт патерну:
 * test-предикат і скоупинг лише js-файлів (без зайвого виклику лінтерів).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

const loadActualModule = createRequire(import.meta.url)
const actualChildProcess = loadActualModule('node:child_process')
const spawnSyncMock = vi.fn(() => ({ status: 0 }))
vi.mock('node:child_process', () => ({
  ...actualChildProcess,
  spawnSync: spawnSyncMock
}))

const resolveCmdMock = vi.fn(() => '/usr/local/bin/bunx')
vi.mock('@7n/rules/scripts/utils/resolve-cmd.mjs', () => ({ resolveCmd: resolveCmdMock }))

const lintFilesMock = vi.fn(() => [])
const outputFixesMock = vi.fn()
vi.mock('eslint', () => ({
  ESLint: class {
    static outputFixes(...args) {
      return outputFixesMock(...args)
    }

    lintFiles(...args) {
      return lintFilesMock(...args)
    }
  }
}))

const { patterns } = await import('../fix-eslint.mjs')
const { withTmpDir } = await import('@7n/rules/scripts/utils/test-helpers.mjs')

const AUTOFIX = patterns[0]
const MECHANICAL = patterns[1]

describe('js-eslint-autofix pattern', () => {
  test('2 патерни, перший — очікуваний id', () => {
    expect(patterns).toHaveLength(2)
    expect(AUTOFIX.id).toBe('js-eslint-autofix')
  })

  test('test: true коли є violation з file', () => {
    expect(AUTOFIX.test([{ reason: 'x', message: 'm', file: 'a.mjs' }])).toBe(true)
  })

  test('test: false коли violations без file', () => {
    expect(AUTOFIX.test([{ reason: 'x', message: 'm' }])).toBe(false)
    expect(AUTOFIX.test([])).toBe(false)
  })

  test('apply: лише не-js файли → лінтери не запускаються, touchedFiles порожній', async () => {
    const res = await AUTOFIX.apply([{ reason: 'x', message: 'm', file: 'README.md' }], { cwd: '/nonexistent-cwd' })
    expect(res.touchedFiles).toEqual([])
  })

  test('apply: js-файл, bunx резолвиться → spawnSync з абсолютним шляхом резолвлений через resolveCmd', async () => {
    await withTmpDir(async dir => {
      const file = join(dir, 'a.js')
      writeFileSync(file, 'const x = 1\n', 'utf8')
      spawnSyncMock.mockClear()
      resolveCmdMock.mockClear().mockReturnValueOnce('/usr/local/bin/bunx')
      lintFilesMock.mockResolvedValueOnce([])

      await AUTOFIX.apply([{ reason: 'x', message: 'm', file: 'a.js' }], { cwd: dir })

      expect(resolveCmdMock).toHaveBeenCalledWith('bunx')
      expect(spawnSyncMock).toHaveBeenCalledWith(
        '/usr/local/bin/bunx',
        ['oxlint', '--fix', 'a.js'],
        expect.objectContaining({ cwd: dir })
      )
      expect(outputFixesMock).toHaveBeenCalled()
    })
  })

  test('apply: bunx не знайдено в PATH → oxlint --fix пропускається, eslint --fix все одно виконується', async () => {
    await withTmpDir(async dir => {
      const file = join(dir, 'a.js')
      writeFileSync(file, 'const x = 1\n', 'utf8')
      spawnSyncMock.mockClear()
      resolveCmdMock.mockClear().mockReturnValueOnce(null)
      lintFilesMock.mockResolvedValueOnce([])

      await AUTOFIX.apply([{ reason: 'x', message: 'm', file: 'a.js' }], { cwd: dir })

      expect(spawnSyncMock).not.toHaveBeenCalled()
      expect(outputFixesMock).toHaveBeenCalled()
    })
  })
})

describe('js-eslint-mechanical-text-fix pattern', () => {
  test('id', () => {
    expect(MECHANICAL.id).toBe('js-eslint-mechanical-text-fix')
  })

  test('test: true на unicorn/prefer-number-is-safe-integer (обидва формати reason)', () => {
    expect(
      MECHANICAL.test([
        { reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } }
      ])
    ).toBe(true)
    expect(
      MECHANICAL.test([
        { reason: 'unicorn(prefer-number-is-safe-integer)', message: 'm', file: 'a.js', data: { line: 1 } }
      ])
    ).toBe(true)
  })

  test('test: false без file/data.line або на невідомому reason', () => {
    expect(MECHANICAL.test([{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm' }])).toBe(false)
    expect(MECHANICAL.test([{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js' }])).toBe(
      false
    )
    expect(MECHANICAL.test([{ reason: 'jsdoc/require-returns', message: 'm', file: 'a.js', data: { line: 1 } }])).toBe(
      false
    )
    expect(MECHANICAL.test([])).toBe(false)
  })

  test('apply: замінює Number.isInteger → Number.isSafeInteger лише на позначеному рядку', async () => {
    await withTmpDir(async dir => {
      const file = join(dir, 'a.js')
      writeFileSync(file, 'const ok = Number.isInteger(x)\nconst other = Number.isInteger(y)\n', 'utf8')
      const recordWrite = vi.fn()
      const res = await MECHANICAL.apply(
        [{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } }],
        { cwd: dir, recordWrite }
      )
      expect(res.touchedFiles).toEqual([file])
      expect(recordWrite).toHaveBeenCalledWith(file)
      const content = readFileSync(file, 'utf8')
      expect(content).toBe('const ok = Number.isSafeInteger(x)\nconst other = Number.isInteger(y)\n')
    })
  })

  test('apply: рядок без очікуваного шаблону (файл змінився з detect-у) → пропускається, файл не пишеться', async () => {
    await withTmpDir(async dir => {
      const file = join(dir, 'a.js')
      writeFileSync(file, 'const ok = SOMETHING_ELSE\n', 'utf8')
      const res = await MECHANICAL.apply(
        [{ reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } }],
        { cwd: dir, recordWrite: vi.fn() }
      )
      expect(res.touchedFiles).toEqual([])
    })
  })

  test('apply: декілька порушень у різних файлах — усі торкнуті файли повертаються', async () => {
    await withTmpDir(async dir => {
      const fileA = join(dir, 'a.js')
      const fileB = join(dir, 'b.js')
      writeFileSync(fileA, 'Number.isInteger(x)\n', 'utf8')
      writeFileSync(fileB, 'Number.isInteger(y)\n', 'utf8')
      const res = await MECHANICAL.apply(
        [
          { reason: 'unicorn/prefer-number-is-safe-integer', message: 'm', file: 'a.js', data: { line: 1 } },
          { reason: 'unicorn(prefer-number-is-safe-integer)', message: 'm', file: 'b.js', data: { line: 1 } }
        ],
        { cwd: dir, recordWrite: vi.fn() }
      )
      expect(res.touchedFiles.toSorted()).toEqual([fileA, fileB].toSorted())
    })
  })
})

describe('js-eslint-autofix — nullable guard через central fix pipeline', () => {
  test('зберігає == null для null/undefined, а звичайне loose equality лишає порушенням', async () => {
    const { runFixPipeline } = await import('../../../../../../npm/scripts/lib/lint-surface/run-fix.mjs')
    const bunx = actualChildProcess.execFileSync('/usr/bin/env', ['which', 'bunx'], { encoding: 'utf8' }).trim()
    resolveCmdMock.mockImplementation(() => bunx)
    spawnSyncMock.mockImplementation((...args) => actualChildProcess.spawnSync(...args))
    const detectorUrl = pathToFileURL(join(import.meta.dirname, '..', 'main.mjs')).href
    const fixUrl = pathToFileURL(join(import.meta.dirname, '..', 'fix-eslint.mjs')).href
    const canonicalPath = join(import.meta.dirname, '..', '..', 'tooling', 'data', 'tooling', 'oxlint-canonical.json')
    const eslintConfigUrl = pathToFileURL(
      join(import.meta.dirname, '..', '..', '..', '..', '..', '..', 'eslint.config.js')
    ).href
    const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8'))
    const ladder = [
      {
        tier: 'local-min',
        model: 'test/no-llm',
        feedback: false,
        local: true,
        isAvg: false,
        timeoutMs: 1000
      }
    ]

    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'js', 'eslint')
      mkdirSync(concernDir, { recursive: true })
      writeFileSync(
        join(concernDir, 'concern.json'),
        `${JSON.stringify({ lint: { scope: 'per-file', glob: ['**/*.mjs'] } }, null, 2)}\n`
      )
      writeFileSync(join(concernDir, 'main.mjs'), `export { lint } from ${JSON.stringify(detectorUrl)}\n`)
      writeFileSync(join(concernDir, 'fix-eslint.mjs'), `export { patterns } from ${JSON.stringify(fixUrl)}\n`)
      writeFileSync(
        join(dir, '.oxlintrc.json'),
        `${JSON.stringify(
          {
            rules: {
              eqeqeq: canonical.rules.eqeqeq,
              'no-eq-null': canonical.rules['no-eq-null']
            }
          },
          null,
          2
        )}\n`
      )
      writeFileSync(join(dir, 'eslint.config.mjs'), `export { default } from ${JSON.stringify(eslintConfigUrl)}\n`)

      const nullablePath = join(dir, 'nullable.mjs')
      writeFileSync(nullablePath, 'export function isNullish(value) { return value == null }\n')
      let nullableWorkerCalled = false
      const nullableCode = await runFixPipeline({
        rulesDir: join(dir, 'rules'),
        cwd: dir,
        rules: ['js'],
        files: ['nullable.mjs'],
        log: () => {},
        deps: {
          ladder,
          workerFor: () => () => {
            nullableWorkerCalled = true
          }
        }
      })

      expect(nullableCode).toBe(0)
      expect(nullableWorkerCalled).toBe(false)
      expect(readFileSync(nullablePath, 'utf8')).toContain('value == null')
      const { isNullish } = await import(`${pathToFileURL(nullablePath).href}?nullable-guard`)
      expect(isNullish(null)).toBe(true)
      expect(isNullish(undefined)).toBe(true)
      expect(isNullish('ordinary')).toBe(false)

      const loosePath = join(dir, 'loose.mjs')
      writeFileSync(loosePath, 'export function looselyEqual(left, right) { return left == right }\n')
      let looseWorkerCalled = false
      const looseCode = await runFixPipeline({
        rulesDir: join(dir, 'rules'),
        cwd: dir,
        rules: ['js'],
        files: ['loose.mjs'],
        log: () => {},
        deps: {
          ladder,
          workerFor: () => () => {
            looseWorkerCalled = true
          }
        }
      })

      expect(looseCode).toBe(1)
      expect(looseWorkerCalled).toBe(true)
      expect(readFileSync(loosePath, 'utf8')).toContain('left == right')
    })
  })
})
