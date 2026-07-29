import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import provider, { defaultRunner } from '../provider.mjs'

/**
 * Clover-фрагмент із file-рівня metrics під переданим `dir` (шляхи мають
 * рібейзитись відносно cwd у provider.collectPerFile/collect).
 * @param {Array<{path: string, statements: number, coveredstatements: number}>} files файли й лічильники
 * @returns {string} вміст clover.xml
 */
function buildClover(files) {
  const body = files
    .map(
      f =>
        `<file name="${f.path}"><metrics methods="0" coveredmethods="0" statements="${f.statements}" coveredstatements="${f.coveredstatements}"/></file>`
    )
    .join('\n')
  return `<coverage><project>${body}</project></coverage>`
}

const INFECTION_FIXTURE = {
  stats: { killedCount: 1, timedOutCount: 0, escapedCount: 1, notCoveredByTestsCount: 0 },
  escaped: [{ mutatorName: 'Plus', originalFilePath: 'src/Foo.php', location: { start: { line: 1, column: 1 } } }]
}

/**
 * Runner-стаб: пише clover.xml і (опційно) infection.json, без реального php-тулчейну.
 * @param {{clover?: string, hasPest?: boolean, hasPhpunit?: boolean, hasInfection?: boolean, infectionJson?: object|null, coverageExit?: number}} cfg конфіг стаба
 * @returns {typeof import('../provider.mjs').defaultRunner} стаб
 */
function stubRunner(cfg = {}) {
  const {
    clover = '<coverage><project></project></coverage>',
    hasPest = false,
    hasPhpunit = true,
    hasInfection = false,
    infectionJson,
    coverageExit = 0
  } = cfg
  return {
    hasVendorBin: (cwd, name) => {
      if (name === 'pest') return hasPest
      if (name === 'phpunit') return hasPhpunit
      if (name === 'infection') return hasInfection
      return false
    },
    runCoverage({ cloverPath }) {
      writeFileSync(cloverPath, clover)
      return coverageExit
    },
    runInfection({ jsonPath }) {
      if (infectionJson !== undefined && infectionJson !== null) {
        writeFileSync(jsonPath, JSON.stringify(infectionJson))
        return 0
      }
      return 1
    }
  }
}

describe('контракт провайдера', () => {
  test('id/title/detect/collect/collectPerFile присутні', () => {
    expect(provider.id).toBe('php')
    expect(typeof provider.title).toBe('string')
    expect(typeof provider.detect).toBe('function')
    expect(typeof provider.collect).toBe('function')
    expect(typeof provider.collectPerFile).toBe('function')
  })
})

describe('defaultRunner.hasVendorBin (реальна файлова система)', () => {
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'php-vendor-')))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('файл є у vendor/bin → true', () => {
    mkdirSync(join(dir, 'vendor', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'bin', 'phpunit'), '#!/bin/sh\n')
    expect(defaultRunner.hasVendorBin(dir, 'phpunit')).toBe(true)
  })

  test('файла немає → false', () => {
    expect(defaultRunner.hasVendorBin(dir, 'phpunit')).toBe(false)
  })
})

describe('detect', () => {
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'php-detect-')))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('без composer.json → false', async () => {
    expect(await provider.detect(dir)).toBe(false)
  })

  test('composer.json без тестового сигналу (ні phpunit.xml, ні Pest) → false', async () => {
    writeFileSync(join(dir, 'composer.json'), '{}')
    expect(await provider.detect(dir)).toBe(false)
  })

  test('composer.json + phpunit.xml, але vendor/bin порожній → false', async () => {
    writeFileSync(join(dir, 'composer.json'), '{}')
    writeFileSync(join(dir, 'phpunit.xml'), '<phpunit/>')
    expect(await provider.detect(dir)).toBe(false)
  })

  test('composer.json + phpunit.xml.dist + vendor/bin/phpunit → true', async () => {
    writeFileSync(join(dir, 'composer.json'), '{}')
    writeFileSync(join(dir, 'phpunit.xml.dist'), '<phpunit/>')
    mkdirSync(join(dir, 'vendor', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'bin', 'phpunit'), '#!/bin/sh\n')
    expect(await provider.detect(dir)).toBe(true)
  })

  test('composer.json + Pest у require-dev + vendor/bin/pest → true', async () => {
    writeFileSync(join(dir, 'composer.json'), JSON.stringify({ 'require-dev': { 'pestphp/pest': '^2.0' } }))
    mkdirSync(join(dir, 'vendor', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'bin', 'pest'), '#!/bin/sh\n')
    expect(await provider.detect(dir)).toBe(true)
  })

  test('невалідний composer.json (не парситься) → без Pest-сигналу, false', async () => {
    writeFileSync(join(dir, 'composer.json'), '{not json')
    expect(await provider.detect(dir)).toBe(false)
  })
})

describe('collect (інжектований runner)', () => {
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'php-collect-')))
    writeFileSync(join(dir, 'composer.json'), '{}')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('без composer.json → []', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'php-nocmp-')))
    try {
      expect(await provider.collect(empty, { runner: stubRunner() })).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  test('без phpunit/pest у vendor → []', async () => {
    expect(await provider.collect(dir, { runner: stubRunner({ hasPhpunit: false }) })).toEqual([])
  })

  test('coverage + мутаційний вимір в один рядок PHP', async () => {
    const clover = buildClover([{ path: join(dir, 'src', 'Foo.php'), statements: 10, coveredstatements: 7 }])
    const runner = stubRunner({ clover, hasInfection: true, infectionJson: INFECTION_FIXTURE })
    const rows = await provider.collect(dir, { runner })
    expect(rows).toHaveLength(1)
    expect(rows[0].area).toBe('PHP')
    expect(rows[0].coverage.lines).toEqual({ covered: 7, total: 10 })
    expect(rows[0].mutation).toEqual({ caught: 1, total: 2 })
    expect(rows[0].survived).toHaveLength(1)
    expect(rows[0].survived[0].file).toBe(join('src', 'Foo.php'))
  })

  test('без infection → лише line coverage, без помилки', async () => {
    const clover = buildClover([{ path: join(dir, 'src', 'Foo.php'), statements: 10, coveredstatements: 5 }])
    const runner = stubRunner({ clover, hasInfection: false })
    const rows = await provider.collect(dir, { runner })
    expect(rows[0].mutation).toEqual({ caught: 0, total: 0 })
    expect(rows[0].survived).toEqual([])
  })

  test('coverage-бінарник завершився з помилкою → кидає з кодом', async () => {
    const runner = stubRunner({ coverageExit: 3 })
    await expect(provider.collect(dir, { runner })).rejects.toThrow('exit 3')
  })

  test('infection встановлено, але не лишив JSON-звіт → зрозуміла помилка', async () => {
    const clover = buildClover([{ path: join(dir, 'src', 'Foo.php'), statements: 1, coveredstatements: 1 }])
    const runner = stubRunner({ clover, hasInfection: true, infectionJson: null })
    await expect(provider.collect(dir, { runner })).rejects.toThrow('JSON-звіт')
  })

  test('нічого не покрито і мутантів немає → []', async () => {
    const runner = stubRunner({ clover: buildClover([]) })
    expect(await provider.collect(dir, { runner })).toEqual([])
  })
})

describe('collectPerFile', () => {
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'php-perfile-')))
    writeFileSync(join(dir, 'composer.json'), '{}')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('фільтрує до запитаних .php, тестові файли поза гейтом', async () => {
    const clover = buildClover([
      { path: join(dir, 'src', 'Main.php'), statements: 10, coveredstatements: 3 },
      { path: join(dir, 'tests', 'MainTest.php'), statements: 5, coveredstatements: 5 }
    ])
    const runner = stubRunner({ clover })
    const rows = await provider.collectPerFile(dir, {
      files: ['src/Main.php', 'tests/MainTest.php', 'src/Other.php'],
      runner
    })
    expect(rows).toEqual([{ file: join('src', 'Main.php'), pct: 30, linesFound: 10, linesCovered: 3 }])
  })

  test('без .php-кандидатів → без прогонів', async () => {
    let called = false
    const runner = stubRunner()
    runner.runCoverage = () => {
      called = true
      return 0
    }
    const rows = await provider.collectPerFile(dir, { files: ['src/app.mjs', 'README.md'], runner })
    expect(rows).toEqual([])
    expect(called).toBe(false)
  })

  test('без composer.json → []', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'php-perfile-nocmp-')))
    try {
      const rows = await provider.collectPerFile(empty, { files: ['src/Main.php'], runner: stubRunner() })
      expect(rows).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  test('без phpunit/pest у vendor → []', async () => {
    const rows = await provider.collectPerFile(dir, {
      files: ['src/Main.php'],
      runner: stubRunner({ hasPhpunit: false })
    })
    expect(rows).toEqual([])
  })
})
