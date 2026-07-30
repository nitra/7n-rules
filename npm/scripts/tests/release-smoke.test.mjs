/**
 * Тести `release-smoke.mjs`: чиста логіка (`satisfiesKnownRange`, `bunAddWithRetry`, fixture-файли,
 * усі `checkFixtureX*`/`checkVersionReconciliation`) — з інжектованим `spawnFn`/`npmViewLatest`,
 * без мережі й реального `bun`/`npx`. Fixture-оркестрація (`runFixtureA`/`runFixtureB`/`main`) —
 * фейковий `spawnFn`, що симулює побічні ефекти `bun add`/`npx n-rules`/`lint` на реальному
 * tmp-каталозі (записує package.json/.n-rules.json/node_modules-артефакти так само, як реальні
 * команди), тож кожен тип провалу зі спеки (відсутній пакет у devDeps, не створений
 * `lint-php.yml`, diff із template, розсинхрон ranges) відтворюється детерміновано й офлайн.
 *
 * Реальний мережевий e2e (живий registry, справжні `bun add`/`npx n-rules`) — окремий
 * `test.skipIf`-блок унизу за опційним `N_RELEASE_SMOKE_E2E`; у звичайному прогоні пропускається.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { describe, expect, test } from 'vitest'

import {
  bunAddWithRetry,
  checkFixtureADevDependencies,
  checkFixtureALintPhp,
  checkFixtureALintPhpYml,
  checkFixtureAConfig,
  checkFixtureB,
  checkVersionReconciliation,
  main,
  readInstalledKnownPluginRanges,
  runFixtureA,
  runFixtureB,
  satisfiesKnownRange,
  writeFixtureAFiles,
  writeFixtureBFiles
} from '../release-smoke.mjs'
import { withTmpDir } from '../utils/test-helpers.mjs'

const FIXTURE_KNOWN_RANGES = Object.freeze({
  '@7n/rules-lang-php': '^0.2',
  '@7n/rules-lang-js': '^0.23',
  '@7n/rules-ci-github': '^2'
})

/**
 * Пише в `dir` фейковий встановлений core (`node_modules/@7n/rules/scripts/lib/resolve-plugins.mjs`)
 * з `KNOWN_PLUGIN_RANGES` фікстури.
 * @param {string} dir корінь фікстури
 * @returns {void}
 */
function writeFakeInstalledCore(dir) {
  const libDir = join(dir, 'node_modules', '@7n', 'rules', 'scripts', 'lib')
  mkdirSync(libDir, { recursive: true })
  writeFileSync(
    join(libDir, 'resolve-plugins.mjs'),
    `export const KNOWN_PLUGIN_RANGES = ${JSON.stringify(FIXTURE_KNOWN_RANGES)}\n`
  )
}

/**
 * Симулює bun add -d `@7n/rules@latest`: пише fake встановлений core у `node_modules`.
 * @param {string} cwd робоча директорія фікстури
 * @param {boolean} shouldFail true — симулювати провал (registry error)
 * @returns {{ status: number, stdout: string, stderr: string }} результат у форматі `spawnSync`
 */
function simulateBunAdd(cwd, shouldFail) {
  if (shouldFail) return { status: 1, stdout: '', stderr: 'registry error' }
  writeFakeInstalledCore(cwd)
  return { status: 0, stdout: '', stderr: '' }
}

/**
 * Симулює `npx n-rules` (sync): дописує devDependencies плагінів + `.n-rules.json` +
 * (за наявності `composer.json`) canonical PHP CI-template у `node_modules`.
 * @param {string} cwd робоча директорія фікстури
 * @param {boolean} hasPhp true — симулювати auto-install `@7n/rules-lang-php`
 * @returns {{ status: number, stdout: string, stderr: string }} результат у форматі `spawnSync`
 */
function simulateSync(cwd, hasPhp) {
  const pkgPath = join(cwd, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.devDependencies = {
    ...pkg.devDependencies,
    '@7n/rules-lang-js': FIXTURE_KNOWN_RANGES['@7n/rules-lang-js'],
    '@7n/rules-ci-github': FIXTURE_KNOWN_RANGES['@7n/rules-ci-github']
  }
  const rules = ['ci_artifact', 'test']
  if (hasPhp) {
    pkg.devDependencies['@7n/rules-lang-php'] = FIXTURE_KNOWN_RANGES['@7n/rules-lang-php']
    rules.push('php')
    const templateDir = join(cwd, 'node_modules', '@7n', 'rules-lang-php', 'slots', 'ci', 'github')
    mkdirSync(templateDir, { recursive: true })
    writeFileSync(join(templateDir, 'lint-php.yml.snippet.yml'), 'name: Lint PHP\n')
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  writeFileSync(join(cwd, '.n-rules.json'), `${JSON.stringify({ rules }, null, 2)}\n`)
  return { status: 0, stdout: '', stderr: '' }
}

/**
 * Симулює `npx n-rules lint ci_artifact`: матеріалізує (чи ні) `.github/workflows/lint-php.yml`.
 * @param {string} cwd робоча директорія фікстури
 * @param {boolean} skip true — не створювати файл (симулює провал матеріалізації)
 * @param {boolean} diff true — створити з відхиленням від template
 * @returns {{ status: number, stdout: string, stderr: string }} результат у форматі `spawnSync`
 */
function simulateLintCiArtifact(cwd, skip, diff) {
  if (!skip) {
    mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(cwd, '.github', 'workflows', 'lint-php.yml'),
      diff ? 'name: Lint PHP (diff)\n' : 'name: Lint PHP\n'
    )
  }
  return { status: 0, stdout: '', stderr: '' }
}

/**
 * Фейковий `spawnFn`: симулює побічні ефекти `bun add -d`/`npx n-rules`/`npx n-rules lint …` на
 * реальному tmp-каталозі (файли пише як реальні команди), без мережі/зовнішніх процесів.
 * @param {{ hasPhp?: boolean, bunAddFails?: boolean, syncFails?: boolean, lintYmlMissing?: boolean,
 *   lintYmlDiff?: boolean, lintPhpCrash?: boolean, lintPhpStatus?: number }} [scenario] керує гілками провалу
 * @returns {import('../release-smoke.mjs').SpawnFn} фейковий spawnFn
 */
function createFixtureSpawn(scenario = {}) {
  const {
    hasPhp,
    bunAddFails = false,
    syncFails = false,
    lintYmlMissing = false,
    lintYmlDiff = false,
    lintPhpCrash = false,
    lintPhpStatus = 1
  } = scenario

  return function fakeSpawn(cmd, args, opts) {
    if (cmd === 'git') return { status: 0, stdout: '', stderr: '' }
    if (cmd === 'bun' && args[0] === 'add') return simulateBunAdd(opts.cwd, bunAddFails)
    if (cmd === 'npx' && args.length === 1 && args[0] === 'n-rules') {
      if (syncFails) return { status: 1, stdout: '', stderr: 'sync failed' }
      // Без явного override — те саме файлове detection, що й реальний core: composer.json
      // у cwd → php. Дозволяє одному й тому самому spawnFn коректно обслужити ОБИДВІ фікстури
      // всередині `main()` (A з composer.json, B без) без ручного перемикання прапорця.
      const effectiveHasPhp = hasPhp ?? existsSync(join(opts.cwd, 'composer.json'))
      return simulateSync(opts.cwd, effectiveHasPhp)
    }
    if (cmd === 'npx' && args[1] === 'lint' && args[2] === 'ci_artifact') {
      return simulateLintCiArtifact(opts.cwd, lintYmlMissing, lintYmlDiff)
    }
    if (cmd === 'npx' && args[1] === 'lint' && args[2] === 'php') {
      if (lintPhpCrash) return { status: null, stdout: '', stderr: 'timeout', error: new Error('timeout') }
      return { status: lintPhpStatus, stdout: 'php/composer_manifest — 1 порушення', stderr: '' }
    }
    throw new Error(`fakeSpawn: непередбачений виклик ${cmd} ${args.join(' ')}`)
  }
}

/**
 * `npmViewLatest`-фейк: `@7n/rules` → фіксована версія core; кожен інший пакет → перша
 * (найнижча) версія в межах відповідного `FIXTURE_KNOWN_RANGES` (реальний happy-path).
 * @param {string} pkg npm-ім'я
 * @returns {Promise<string>} версія
 */
function happyNpmViewLatest(pkg) {
  if (pkg === '@7n/rules') return Promise.resolve('1.58.3')
  const range = FIXTURE_KNOWN_RANGES[pkg]
  return Promise.resolve(range.startsWith('^0') ? `${range.slice(1)}.9` : '2.1.0')
}

/**
 * `npmViewLatest`-фейк: ніщо не резолвиться (усе «не опубліковано») — core-404-сценарій.
 * @returns {Promise<null>} завжди `null`
 */
function npmViewLatestAllUnpublished() {
  return Promise.resolve(null)
}

/**
 * `npmViewLatest`-фейк: core опублікований, конкретний плагін — ні (404).
 * @param {string} pkg npm-ім'я
 * @returns {Promise<string | null>} версія core, `null` для решти
 */
function npmViewLatestPluginUnpublished(pkg) {
  return Promise.resolve(pkg === '@7n/rules' ? '1.58.3' : null)
}

/**
 * `npmViewLatest`-фейк: core опублікований, плагін опублікований, але поза
 * `KNOWN_PLUGIN_RANGES` (реальний клас бага — legacy-лінія).
 * @param {string} pkg npm-ім'я
 * @returns {Promise<string>} версія
 */
function npmViewLatestOutOfRange(pkg) {
  return Promise.resolve(pkg === '@7n/rules' ? '1.58.3' : '0.25.1')
}

/**
 * `npmViewLatest`-фейк: усі плагіни опубліковані далеко поза будь-яким реалістичним range.
 * @param {string} pkg npm-ім'я
 * @returns {Promise<string>} версія
 */
function npmViewLatestFarOutOfRange(pkg) {
  return Promise.resolve(pkg === '@7n/rules' ? '1.58.3' : '99.0.0')
}

/**
 * `npmViewLatest`-фейк: плагіни опубліковані в межах `^0.2` (лінія `lang-php`).
 * @param {string} pkg npm-ім'я
 * @returns {Promise<string>} версія
 */
function npmViewLatestPhpLineInRange(pkg) {
  return Promise.resolve(pkg === '@7n/rules' ? '1.58.3' : '0.2.9')
}

/**
 * `spawnFn`-фейк: `lint php --no-fix` завершується чистим exit 1 (violations, без креша).
 * @returns {{ status: number, stdout: string, stderr: string }} результат у форматі `spawnSync`
 */
function cleanExitLintPhpSpawn() {
  return { status: 1, stdout: 'php/composer_manifest — 1 порушення', stderr: '' }
}

/**
 * `spawnFn`-фейк: процес не запустився (ENOENT/timeout) — крашем вважається.
 * @returns {{ status: null, stdout: string, stderr: string, error: Error }} результат у форматі `spawnSync`
 */
function timeoutErrorSpawn() {
  return { status: null, stdout: '', stderr: '', error: new Error('timeout') }
}

/**
 * `spawnFn`-фейк: `bun`/`npx` не знайдено у PATH (ENOENT) — використовується у ретрай-тестах.
 * @returns {{ status: null, stdout: string, stderr: string, error: Error }} результат у форматі `spawnSync`
 */
function enoentErrorSpawn() {
  return { status: null, stdout: '', stderr: '', error: new Error('spawn bun ENOENT') }
}

/**
 * `spawnFn`-фейк: у виводі стектрейс невловленого винятку — крашем вважається.
 * @returns {{ status: number, stdout: string, stderr: string }} результат у форматі `spawnSync`
 */
function stackTraceInOutputSpawn() {
  return { status: 1, stdout: 'TypeError: x\n  at file:///repo/foo.mjs:1:1', stderr: '' }
}

describe('satisfiesKnownRange', () => {
  test('^N — весь major N', () => {
    expect(satisfiesKnownRange('2.1.0', '^2')).toBe(true)
    expect(satisfiesKnownRange('2.9.9', '^2')).toBe(true)
    expect(satisfiesKnownRange('3.0.0', '^2')).toBe(false)
  })

  test('^0.N — лише мінор N (0.x caret-семантика)', () => {
    expect(satisfiesKnownRange('0.23.10', '^0.23')).toBe(true)
    expect(satisfiesKnownRange('0.25.1', '^0.23')).toBe(false)
    expect(satisfiesKnownRange('0.22.9', '^0.23')).toBe(false)
  })

  test('невалідні version/range — false, без винятку', () => {
    expect(satisfiesKnownRange('not-a-version', '^2')).toBe(false)
    expect(satisfiesKnownRange('2.1.0', '~2')).toBe(false)
    expect(satisfiesKnownRange('2.1.0', 'latest')).toBe(false)
  })
})

describe('bunAddWithRetry', () => {
  test('успіх з першого разу — без ретраїв', async () => {
    let calls = 0
    const spawnFn = () => {
      calls += 1
      return { status: 0, stdout: '', stderr: '' }
    }
    const result = await bunAddWithRetry('/tmp/whatever', '@7n/rules@latest', { spawnFn, delayMs: 0 })
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(1)
  })

  test('успіх після одного ретраю', async () => {
    let calls = 0
    const spawnFn = () => {
      calls += 1
      if (calls === 1) return { status: 1, stdout: '', stderr: 'ETIMEDOUT' }
      return { status: 0, stdout: '', stderr: '' }
    }
    const result = await bunAddWithRetry('/tmp/whatever', '@7n/rules@latest', { spawnFn, delayMs: 0, retries: 2 })
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(2)
  })

  test('вичерпані ретраї — ok:false з деталями останньої помилки', async () => {
    let calls = 0
    const spawnFn = () => {
      calls += 1
      return { status: 1, stdout: '', stderr: 'E404 not found' }
    }
    const result = await bunAddWithRetry('/tmp/whatever', '@7n/rules-lang-php@latest', {
      spawnFn,
      delayMs: 0,
      retries: 2
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('@7n/rules-lang-php@latest')
    expect(calls).toBe(3)
  })

  test('spawnFn повертає error-обʼєкт (напр. ENOENT) — теж ретраїться і фейлить деталь', async () => {
    const result = await bunAddWithRetry('/tmp/whatever', '@7n/rules@latest', {
      spawnFn: enoentErrorSpawn,
      delayMs: 0,
      retries: 0
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ENOENT')
  })
})

describe('writeFixtureAFiles / writeFixtureBFiles', () => {
  test('Фікстура A: package.json + composer.json + .github/workflows/ci.yml', async () => {
    await withTmpDir(async dir => {
      await writeFixtureAFiles(dir)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.private).toBe(true)
      expect(pkg.repository.url).toContain('github.com')
      const composer = JSON.parse(await readFile(join(dir, 'composer.json'), 'utf8'))
      expect(composer.require.php).toBeDefined()
      const ci = await readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')
      expect(ci).toContain('runs-on: ubuntu-latest')
    })
  })

  test('Фікстура B: без composer.json', async () => {
    await withTmpDir(async dir => {
      await writeFixtureBFiles(dir)
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(pkg.private).toBe(true)
      await expect(readFile(join(dir, 'composer.json'), 'utf8')).rejects.toThrow()
    })
  })
})

describe('readInstalledKnownPluginRanges', () => {
  test('читає KNOWN_PLUGIN_RANGES зі встановленого у фікстурі core', async () => {
    await withTmpDir(async dir => {
      writeFakeInstalledCore(dir)
      const ranges = await readInstalledKnownPluginRanges(dir)
      expect(ranges).toEqual(FIXTURE_KNOWN_RANGES)
    })
  })
})

describe('checkVersionReconciliation', () => {
  test('усе опубліковано і в межах range — усі перевірки ok', async () => {
    const results = await checkVersionReconciliation(FIXTURE_KNOWN_RANGES, { npmViewLatest: happyNpmViewLatest })
    expect(results.every(r => r.ok)).toBe(true)
    expect(results.length).toBe(1 + Object.keys(FIXTURE_KNOWN_RANGES).length)
  })

  test('core не опублікований (404) — провал', async () => {
    const results = await checkVersionReconciliation({}, { npmViewLatest: npmViewLatestAllUnpublished })
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(false)
  })

  test('плагін не опублікований — провал з поясненням', async () => {
    const results = await checkVersionReconciliation(
      { '@7n/rules-lang-php': '^0.2' },
      { npmViewLatest: npmViewLatestPluginUnpublished }
    )
    const pluginResult = results.find(r => r.name.includes('lang-php'))
    expect(pluginResult.ok).toBe(false)
    expect(pluginResult.detail).toContain('не опубліковано')
  })

  test('range розсинхронізований з опублікованим latest — провал (реальний клас бага)', async () => {
    const results = await checkVersionReconciliation(
      { '@7n/rules-lang-js': '^0.23' },
      { npmViewLatest: npmViewLatestOutOfRange }
    )
    const pluginResult = results.find(r => r.name.includes('lang-js'))
    expect(pluginResult.ok).toBe(false)
    expect(pluginResult.detail).toContain('розсинхронізовані')
  })
})

describe('checkFixtureADevDependencies', () => {
  test('усі три плагіни присутні й у межах range', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { ...FIXTURE_KNOWN_RANGES } }))
      const results = checkFixtureADevDependencies(dir, { knownRanges: FIXTURE_KNOWN_RANGES })
      expect(results.every(r => r.ok)).toBe(true)
    })
  })

  test('відсутній @7n/rules-lang-php у devDependencies — провал', async () => {
    await withTmpDir(dir => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          devDependencies: {
            '@7n/rules-lang-js': FIXTURE_KNOWN_RANGES['@7n/rules-lang-js'],
            '@7n/rules-ci-github': FIXTURE_KNOWN_RANGES['@7n/rules-ci-github']
          }
        })
      )
      const results = checkFixtureADevDependencies(dir, { knownRanges: FIXTURE_KNOWN_RANGES })
      const phpResult = results.find(r => r.name.includes('@7n/rules-lang-php'))
      expect(phpResult.ok).toBe(false)
    })
  })

  test('встановлена версія поза KNOWN_PLUGIN_RANGES — провал range-перевірки', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@7n/rules-lang-php': '^0.1' } }))
      const results = checkFixtureADevDependencies(dir, { knownRanges: { '@7n/rules-lang-php': '^0.2' } })
      const rangeResult = results.find(r => r.name.includes('у межах'))
      expect(rangeResult.ok).toBe(false)
    })
  })
})

describe('checkFixtureAConfig', () => {
  test('.n-rules.json відсутній — провал', async () => {
    await withTmpDir(dir => {
      const results = checkFixtureAConfig(dir)
      expect(results).toHaveLength(1)
      expect(results[0].ok).toBe(false)
    })
  })

  test('rules містить php + ci_artifact — усе ok', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['php', 'ci_artifact', 'test'] }))
      const results = checkFixtureAConfig(dir)
      expect(results.every(r => r.ok)).toBe(true)
    })
  })

  test('rules без php — провал відповідної перевірки', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['ci_artifact', 'test'] }))
      const results = checkFixtureAConfig(dir)
      const phpResult = results.find(r => r.name.includes('php'))
      expect(phpResult.ok).toBe(false)
    })
  })
})

describe('checkFixtureALintPhpYml', () => {
  test('файл відсутній — провал', async () => {
    await withTmpDir(dir => {
      const results = checkFixtureALintPhpYml(dir)
      expect(results).toHaveLength(1)
      expect(results[0].ok).toBe(false)
    })
  })

  test('canonical template відсутній у node_modules — окрема діагностика', async () => {
    await withTmpDir(dir => {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(join(dir, '.github', 'workflows', 'lint-php.yml'), 'name: Lint PHP\n')
      const results = checkFixtureALintPhpYml(dir)
      expect(results[0].ok).toBe(true)
      expect(results[1].ok).toBe(false)
    })
  })

  test('байт-ідентичний template — усе ok', async () => {
    await withTmpDir(dir => {
      const templateDir = join(dir, 'node_modules', '@7n', 'rules-lang-php', 'slots', 'ci', 'github')
      mkdirSync(templateDir, { recursive: true })
      writeFileSync(join(templateDir, 'lint-php.yml.snippet.yml'), 'name: Lint PHP\n')
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(join(dir, '.github', 'workflows', 'lint-php.yml'), 'name: Lint PHP\n')
      const results = checkFixtureALintPhpYml(dir)
      expect(results.every(r => r.ok)).toBe(true)
    })
  })

  test('diff із template — провал byte-identical перевірки', async () => {
    await withTmpDir(dir => {
      const templateDir = join(dir, 'node_modules', '@7n', 'rules-lang-php', 'slots', 'ci', 'github')
      mkdirSync(templateDir, { recursive: true })
      writeFileSync(join(templateDir, 'lint-php.yml.snippet.yml'), 'name: Lint PHP\n')
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(join(dir, '.github', 'workflows', 'lint-php.yml'), 'name: Lint PHP (locally patched)\n')
      const results = checkFixtureALintPhpYml(dir)
      expect(results[0].ok).toBe(true)
      expect(results[1].ok).toBe(false)
    })
  })
})

describe('checkFixtureALintPhp', () => {
  test('чистий exit (0 чи 1) — без креша', () => {
    const results = checkFixtureALintPhp('/tmp/whatever', { spawnFn: cleanExitLintPhpSpawn })
    expect(results[0].ok).toBe(true)
  })

  test('spawnFn error (ENOENT/timeout) — крашем вважається', () => {
    const results = checkFixtureALintPhp('/tmp/whatever', { spawnFn: timeoutErrorSpawn })
    expect(results[0].ok).toBe(false)
    expect(results[0].detail).toContain('timeout')
  })

  test('стектрейс невловленого винятку у виводі — крашем вважається', () => {
    const results = checkFixtureALintPhp('/tmp/whatever', { spawnFn: stackTraceInOutputSpawn })
    expect(results[0].ok).toBe(false)
  })
})

describe('checkFixtureB', () => {
  test('без composer.json — devDep і .n-rules.json без php', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: {} }))
      writeFileSync(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['ci_artifact', 'test'] }))
      const results = checkFixtureB(dir)
      expect(results.every(r => r.ok)).toBe(true)
    })
  })

  test('несподівано присутній @7n/rules-lang-php — провал', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@7n/rules-lang-php': '^0.2' } }))
      writeFileSync(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['php'] }))
      const results = checkFixtureB(dir)
      expect(results.some(r => !r.ok)).toBe(true)
    })
  })

  test('.n-rules.json відсутній — провал', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: {} }))
      const results = checkFixtureB(dir)
      expect(results.some(r => !r.ok)).toBe(true)
    })
  })
})

describe('runFixtureA (fake spawnFn, реальний tmp-каталог)', () => {
  test('щасливий шлях — усі перевірки ok', async () => {
    await withTmpDir(async dir => {
      const outcome = await runFixtureA(dir, { spawnFn: createFixtureSpawn() })
      expect(outcome.results.every(r => r.ok)).toBe(true)
      expect(outcome.knownRanges).toEqual(FIXTURE_KNOWN_RANGES)
    })
  })

  test('bun add фейлить — короткий провал без подальших кроків', async () => {
    await withTmpDir(async dir => {
      const result = await runFixtureA(dir, {
        spawnFn: createFixtureSpawn({ bunAddFails: true }),
        retries: 0,
        delayMs: 0
      })
      expect(Array.isArray(result)).toBe(true)
      expect(result[0].ok).toBe(false)
      expect(result[0].name).toContain('bun add')
    })
  })

  test('sync (npx n-rules) фейлить — короткий провал', async () => {
    await withTmpDir(async dir => {
      const result = await runFixtureA(dir, { spawnFn: createFixtureSpawn({ syncFails: true }) })
      expect(Array.isArray(result)).toBe(true)
      expect(result[0].ok).toBe(false)
      expect(result[0].name).toContain('sync')
    })
  })

  test('lint ci_artifact не створив lint-php.yml — провал цієї перевірки', async () => {
    await withTmpDir(async dir => {
      const outcome = await runFixtureA(dir, { spawnFn: createFixtureSpawn({ lintYmlMissing: true }) })
      const ymlResult = outcome.results.find(r => r.name.includes('створив lint-php.yml'))
      expect(ymlResult.ok).toBe(false)
    })
  })

  test('lint-php.yml diff із template — провал byte-identical', async () => {
    await withTmpDir(async dir => {
      const outcome = await runFixtureA(dir, { spawnFn: createFixtureSpawn({ lintYmlDiff: true }) })
      const diffResult = outcome.results.find(r => r.name.includes('байт-ідентичний'))
      expect(diffResult.ok).toBe(false)
    })
  })

  test('lint php --no-fix крашить — провал', async () => {
    await withTmpDir(async dir => {
      const outcome = await runFixtureA(dir, { spawnFn: createFixtureSpawn({ lintPhpCrash: true }) })
      const crashResult = outcome.results.find(r => r.name.includes('без креша'))
      expect(crashResult.ok).toBe(false)
    })
  })
})

describe('runFixtureB (fake spawnFn, реальний tmp-каталог)', () => {
  test('щасливий шлях (без composer.json) — усі перевірки ok', async () => {
    await withTmpDir(async dir => {
      const results = await runFixtureB(dir, { spawnFn: createFixtureSpawn({ hasPhp: false }) })
      expect(results.every(r => r.ok)).toBe(true)
    })
  })

  test('bun add фейлить — короткий провал', async () => {
    await withTmpDir(async dir => {
      const results = await runFixtureB(dir, {
        spawnFn: createFixtureSpawn({ hasPhp: false, bunAddFails: true }),
        retries: 0,
        delayMs: 0
      })
      expect(results[0].ok).toBe(false)
    })
  })

  test('sync фейлить — короткий провал', async () => {
    await withTmpDir(async dir => {
      const results = await runFixtureB(dir, { spawnFn: createFixtureSpawn({ hasPhp: false, syncFails: true }) })
      expect(results[0].ok).toBe(false)
    })
  })
})

describe('main (повна оркестрація, fake spawnFn + fake npmViewLatest)', () => {
  test('усе зелено — main() повертає true', async () => {
    const ok = await main({ spawnFn: createFixtureSpawn(), npmViewLatest: happyNpmViewLatest })
    expect(ok).toBe(true)
  })

  test('range розсинхронізовано з registry — main() повертає false', async () => {
    const ok = await main({ spawnFn: createFixtureSpawn(), npmViewLatest: npmViewLatestFarOutOfRange })
    expect(ok).toBe(false)
  })

  test('Фікстура B несподівано притягнула PHP — main() повертає false', async () => {
    const npmViewLatest = npmViewLatestPhpLineInRange
    // hasPhp:true й для Фікстури B теж — симулює регресію автодетекту (композер-сигнал не мав значення).
    const ok = await main({ spawnFn: createFixtureSpawn({ hasPhp: true }), npmViewLatest })
    expect(ok).toBe(false)
  })
})

describe.skipIf(!env.N_RELEASE_SMOKE_E2E)('release-smoke E2E (живий registry)', () => {
  test('main() проти РЕАЛЬНОГО опублікованого набору', async () => {
    const ok = await main()
    expect(typeof ok).toBe('boolean')
  }, 600_000)
})
