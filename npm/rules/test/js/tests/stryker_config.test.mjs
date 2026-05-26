/**
 * Тести концерну `stryker_config` (test.mdc): self-gates через js-lint
 * у `.n-cursor.json#rules`, side-effect-копіює canonical baseline у jsRoot
 * якщо stryker.config.mjs відсутній.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chdir, cwd as getCwd } from 'node:process'

import { check } from '../stryker_config.mjs'

/**
 * Створює тимчасовий проєкт із заданим `.n-cursor.json#rules` і опційним
 * workspace-layout.
 * @param {{rules?: string[], disableRules?: string[], workspaceRoot?: boolean}} [opts] параметри генерації проєкту
 * @returns {{dir: string, cleanup: () => void}} шлях до проєкту і cleanup
 */
function makeProj({ rules = [], disableRules = [], workspaceRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stryker-config-concern-'))
  writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules, 'disable-rules': disableRules }))
  if (workspaceRoot) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
  } else {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg' }))
  }
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Викликає check() з chdir у заданий каталог, щоб концерн читав .n-cursor.json
 * саме звідти (бо check читає process.cwd()).
 * @param {string} dir каталог проєкту
 * @returns {Promise<number>} exit code
 */
async function runCheckIn(dir) {
  const prev = getCwd()
  chdir(dir)
  try {
    return await check()
  } finally {
    chdir(prev)
  }
}

describe('stryker_config concern', () => {
  test('js-lint НЕ в rules — silent skip, exit 0, файл не створюється', async () => {
    const proj = makeProj({ rules: ['test'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js-lint у disable-rules — silent skip', async () => {
    const proj = makeProj({ rules: ['js-lint', 'test'], disableRules: ['js-lint'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js-lint enabled + stryker.config.mjs відсутній — копіює baseline у cwd (single-package)', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const target = join(proj.dir, 'stryker.config.mjs')
    expect(existsSync(target)).toBe(true)
    const content = readFileSync(target, 'utf8')
    expect(content).toContain("testRunner: 'vitest'")
    expect(content).toContain("vitest: { configFile: 'vitest.config.js' }")
    expect(content).toContain("coverageAnalysis: 'perTest'")
    expect(content).toContain("jsonReporter: { fileName: 'reports/stryker/mutation.json' }")
    expect(content).toContain('incremental: true')
    expect(content).toContain("incrementalFile: 'reports/stryker/incremental.json'")
    proj.cleanup()
  })

  test('js-lint enabled — копіює також vitest.config.js разом зі stryker.config.mjs', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const vitestTarget = join(proj.dir, 'vitest.config.js')
    expect(existsSync(vitestTarget)).toBe(true)
    const content = readFileSync(vitestTarget, 'utf8')
    expect(content).toContain("from 'vitest/config'")
    expect(content).toContain('defineConfig')
    expect(content).toContain("provider: 'v8'")
    proj.cleanup()
  })

  test('js-lint enabled + workspace — копіює обидва файли у workspaces[0] (app/)', async () => {
    const proj = makeProj({ rules: ['js-lint'], workspaceRoot: true })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'app', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(proj.dir, 'app', 'vitest.config.js'))).toBe(true)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    expect(existsSync(join(proj.dir, 'vitest.config.js'))).toBe(false)
    proj.cleanup()
  })

  test('js-lint enabled + кілька workspaces — копіює обидва baseline у КОЖЕН', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stryker-multi-ws-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js-lint'] }))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app', 'scripts'] }))
    mkdirSync(join(dir, 'app'), { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
    writeFileSync(join(dir, 'scripts', 'package.json'), JSON.stringify({ name: 'scripts' }))
    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(dir, 'app', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'app', 'vitest.config.js'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'vitest.config.js'))).toBe(true)
    expect(existsSync(join(dir, 'stryker.config.mjs'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('js-lint enabled + stryker.config.mjs існує — не перезаписує', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, '// custom config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('// custom config')
    proj.cleanup()
  })

  test('js-lint enabled + vitest.config.js існує — не перезаписує', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const target = join(proj.dir, 'vitest.config.js')
    writeFileSync(target, '// custom vitest config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('// custom vitest config')
    proj.cleanup()
  })

  test('js-lint enabled + кореневий package.json відсутній — fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stryker-no-pkg-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js-lint'] }))
    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test('js-lint enabled — додає Stryker-патерни у .gitignore (створює якщо немає)', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const gitignore = readFileSync(join(proj.dir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('**/reports/stryker/')
    expect(gitignore).toContain('# Stryker mutation testing')
    proj.cleanup()
  })

  test('js-lint enabled + .gitignore вже має Stryker-патерн — не дублює', async () => {
    const proj = makeProj({ rules: ['js-lint'] })
    writeFileSync(join(proj.dir, '.gitignore'), 'node_modules/\n**/reports/stryker/\n')
    const before = readFileSync(join(proj.dir, '.gitignore'), 'utf8')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(join(proj.dir, '.gitignore'), 'utf8')).toBe(before)
    proj.cleanup()
  })
})
