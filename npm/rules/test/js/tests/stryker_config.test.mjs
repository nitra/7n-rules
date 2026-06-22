/**
 * Тести концерну `stryker_config` (test.mdc): self-gates через js
 * у `.n-cursor.json#rules`, side-effect-копіює canonical baseline у jsRoot
 * якщо stryker.config.mjs відсутній.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import vitestBaseline from '../data/vitest_config/vitest.config.baseline.js'
import { check } from '../stryker_config.mjs'

// Канонічні baseline-тексти (читаємо з data/, щоб augment-фікстури не дрейфували
// від реальних baseline-ів): non-vue (без plugins/ignorers) і повний vue-варіант.
const STRYKER_BASELINE = readFileSync(
  new URL('../data/stryker_config/stryker.config.baseline.mjs', import.meta.url),
  'utf8'
)
const STRYKER_VUE_BASELINE = readFileSync(
  new URL('../data/stryker_config/stryker.config.vue.baseline.mjs', import.meta.url),
  'utf8'
)

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
 * Викликає `check(dir)` без `process.chdir` (test.mdc: усі production functions
 * приймають перший параметр `cwd = process.cwd()`; це і дозволяє Stryker-у крутити
 * тести у threads-pool, де chdir не підтримується).
 * @param {string} dir каталог проєкту
 * @returns {Promise<number>} exit code
 */
function runCheckIn(dir) {
  return check(dir)
}

describe('stryker_config concern', () => {
  test('js НЕ в rules — silent skip, exit 0, файл не створюється', async () => {
    const proj = makeProj({ rules: ['test'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js у disable-rules — silent skip', async () => {
    const proj = makeProj({ rules: ['js', 'test'], disableRules: ['js'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js enabled + stryker.config.mjs відсутній — копіює baseline у cwd (single-package)', async () => {
    const proj = makeProj({ rules: ['js'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const target = join(proj.dir, 'stryker.config.mjs')
    expect(existsSync(target)).toBe(true)
    const content = readFileSync(target, 'utf8')
    expect(content).toContain("testRunner: 'vitest'")
    expect(content).toContain("vitest: { configFile: 'vitest.config.mjs' }")
    expect(content).toContain("coverageAnalysis: 'perTest'")
    expect(content).toContain("jsonReporter: { fileName: 'reports/stryker/mutation.json' }")
    expect(content).toContain('incremental: true')
    expect(content).toContain("incrementalFile: 'reports/stryker/incremental.json'")
    proj.cleanup()
  })

  test('js enabled — копіює також vitest.config.mjs разом зі stryker.config.mjs', async () => {
    const proj = makeProj({ rules: ['js'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const vitestTarget = join(proj.dir, 'vitest.config.mjs')
    expect(existsSync(vitestTarget)).toBe(true)
    // нові файли — `.mjs`, не `.js` (js.mdc)
    expect(existsSync(join(proj.dir, 'vitest.config.js'))).toBe(false)
    const content = readFileSync(vitestTarget, 'utf8')
    expect(content).toContain("from 'vitest/config'")
    expect(content).toContain('defineConfig')
    expect(content).toContain("provider: 'v8'")
    expect(vitestBaseline.test.environment).toBe('node')
    proj.cleanup()
  })

  test('js enabled + workspace — копіює обидва файли у workspaces[0] (app/)', async () => {
    const proj = makeProj({ rules: ['js'], workspaceRoot: true })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'app', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(proj.dir, 'app', 'vitest.config.mjs'))).toBe(true)
    expect(existsSync(join(proj.dir, 'stryker.config.mjs'))).toBe(false)
    expect(existsSync(join(proj.dir, 'vitest.config.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js enabled + кілька workspaces — копіює обидва baseline у КОЖЕН', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stryker-multi-ws-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js'] }))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app', 'scripts'] }))
    mkdirSync(join(dir, 'app'), { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
    writeFileSync(join(dir, 'scripts', 'package.json'), JSON.stringify({ name: 'scripts' }))
    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(dir, 'app', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'app', 'vitest.config.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'stryker.config.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'vitest.config.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'stryker.config.mjs'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('js enabled + stryker.config.mjs існує — не перезаписує', async () => {
    const proj = makeProj({ rules: ['js'] })
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, '// custom config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('// custom config')
    proj.cleanup()
  })

  test('js enabled + legacy vitest.config.js існує — не перезаписує, .mjs не плодиться, stryker configFile = .js', async () => {
    const proj = makeProj({ rules: ['js'] })
    const target = join(proj.dir, 'vitest.config.js')
    writeFileSync(target, '// custom vitest config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    // legacy `.js` лишається як є; новий `.mjs` поряд не створюється
    expect(readFileSync(target, 'utf8')).toBe('// custom vitest config')
    expect(existsSync(join(proj.dir, 'vitest.config.mjs'))).toBe(false)
    // stryker configFile приведено до фактичного імені — `.js`
    const stryker = readFileSync(join(proj.dir, 'stryker.config.mjs'), 'utf8')
    expect(stryker).toContain("configFile: 'vitest.config.js'")
    proj.cleanup()
  })

  test('js enabled + vitest.config.mjs існує — не перезаписує, .js не плодиться, stryker configFile = .mjs', async () => {
    const proj = makeProj({ rules: ['js'] })
    const target = join(proj.dir, 'vitest.config.mjs')
    writeFileSync(target, '// custom vitest config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('// custom vitest config')
    expect(existsSync(join(proj.dir, 'vitest.config.js'))).toBe(false)
    const stryker = readFileSync(join(proj.dir, 'stryker.config.mjs'), 'utf8')
    expect(stryker).toContain("configFile: 'vitest.config.mjs'")
    proj.cleanup()
  })

  test('js enabled + кореневий package.json відсутній — fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stryker-no-pkg-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js'] }))
    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test('js enabled — додає тест-патерни у .gitignore (створює якщо немає)', async () => {
    const proj = makeProj({ rules: ['js'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const gitignore = readFileSync(join(proj.dir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('**/reports/stryker/')
    expect(gitignore).toContain('**/coverage/')
    expect(gitignore).toContain('# Test artifacts: Stryker + coverage')
    proj.cleanup()
  })

  test('js enabled + .gitignore вже має тест-патерни — не дублює', async () => {
    const proj = makeProj({ rules: ['js'] })
    writeFileSync(join(proj.dir, '.gitignore'), 'node_modules/\n**/reports/stryker/\n**/coverage/\n')
    const before = readFileSync(join(proj.dir, '.gitignore'), 'utf8')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(join(proj.dir, '.gitignore'), 'utf8')).toBe(before)
    proj.cleanup()
  })

  // ── Vue SFC detection ─────────────────────────────────────────────────────

  test('js enabled + jsRoot з .vue у src/ — ставить vue-варіант baseline + плагін', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src', 'components'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'components', 'X.vue'), '<template><div/></template>')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const cfg = readFileSync(join(proj.dir, 'stryker.config.mjs'), 'utf8')
    expect(cfg).toContain("plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']")
    expect(cfg).toContain("ignorers: ['vue-macros']")
    const plugin = readFileSync(join(proj.dir, 'stryker-vue-macros-ignorer.mjs'), 'utf8')
    expect(plugin).toContain('strykerPlugins')
    expect(plugin).toContain('vue-macros')
    proj.cleanup()
  })

  test('js enabled + jsRoot БЕЗ .vue — дефолтний baseline без plugins/ignorers і без файлу плагіна', async () => {
    const proj = makeProj({ rules: ['js'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const cfg = readFileSync(join(proj.dir, 'stryker.config.mjs'), 'utf8')
    expect(cfg).not.toContain('plugins: [')
    expect(cfg).not.toContain('ignorers:')
    expect(existsSync(join(proj.dir, 'stryker-vue-macros-ignorer.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js enabled + .vue лише у одному workspace — vue-варіант ставиться тільки там', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stryker-mixed-ws-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['js'] }))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['gt', 'cli'] }))
    mkdirSync(join(dir, 'gt', 'src'), { recursive: true })
    mkdirSync(join(dir, 'cli', 'src'), { recursive: true })
    writeFileSync(join(dir, 'gt', 'package.json'), JSON.stringify({ name: 'gt' }))
    writeFileSync(join(dir, 'cli', 'package.json'), JSON.stringify({ name: 'cli' }))
    writeFileSync(join(dir, 'gt', 'src', 'A.vue'), '<template><div/></template>')
    writeFileSync(join(dir, 'cli', 'src', 'a.js'), 'export {}')
    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(0)
    const gtCfg = readFileSync(join(dir, 'gt', 'stryker.config.mjs'), 'utf8')
    expect(gtCfg).toContain("ignorers: ['vue-macros']")
    expect(existsSync(join(dir, 'gt', 'stryker-vue-macros-ignorer.mjs'))).toBe(true)
    const cliCfg = readFileSync(join(dir, 'cli', 'stryker.config.mjs'), 'utf8')
    expect(cliCfg).not.toContain('ignorers:')
    expect(existsSync(join(dir, 'cli', 'stryker-vue-macros-ignorer.mjs'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('js enabled + .vue лише у node_modules — НЕ тригерить vue-варіант', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src', 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'node_modules', 'dep', 'X.vue'), '<template/>')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const cfg = readFileSync(join(proj.dir, 'stryker.config.mjs'), 'utf8')
    expect(cfg).not.toContain('ignorers:')
    expect(existsSync(join(proj.dir, 'stryker-vue-macros-ignorer.mjs'))).toBe(false)
    proj.cleanup()
  })

  test('js enabled + vue-варіант уже повний — augment no-op, плагін не перезаписано', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'X.vue'), '<template/>')
    writeFileSync(join(proj.dir, 'stryker.config.mjs'), STRYKER_VUE_BASELINE)
    writeFileSync(join(proj.dir, 'stryker-vue-macros-ignorer.mjs'), '// custom plugin')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    // повний vue-baseline → augment нічого не міняє (byte-identical)
    expect(readFileSync(join(proj.dir, 'stryker.config.mjs'), 'utf8')).toBe(STRYKER_VUE_BASELINE)
    // плагін-файл існує → ensureBaselineFile не перезаписує ручний вміст
    expect(readFileSync(join(proj.dir, 'stryker-vue-macros-ignorer.mjs'), 'utf8')).toBe('// custom plugin')
    proj.cleanup()
  })

  // ── Augment існуючого stryker.config.mjs у Vue-root (drift-hole) ──────────────

  test('augment(a): Vue-root зі старим non-vue config — вставляє plugins/ignorers, зберігає поля й коментарі', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'App.vue'), '<template><div/></template>')
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, STRYKER_BASELINE)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const cfg = readFileSync(target, 'utf8')
    expect(cfg).toContain("plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']")
    expect(cfg).toContain("ignorers: ['vue-macros']")
    // решта полів збережена 1-в-1
    expect(cfg).toContain("testRunner: 'vitest'")
    expect(cfg).toContain("coverageAnalysis: 'perTest'")
    expect(cfg).toContain("incrementalFile: 'reports/stryker/incremental.json'")
    // коментарі baseline збережені (string-splice не переформатовує файл)
    expect(cfg).toContain('// perTest:')
    expect(cfg).toContain('// incremental:')
    proj.cleanup()
  })

  test('augment(b): Vue-root з повним vue-baseline — no-op, файл byte-identical', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'App.vue'), '<template><div/></template>')
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, STRYKER_VUE_BASELINE)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(STRYKER_VUE_BASELINE)
    proj.cleanup()
  })

  test('augment(c): частковий config — додає vue-плагін у plugins, створює ignorers, без дублів', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'App.vue'), '<template><div/></template>')
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(
      target,
      ['export default {', "  testRunner: 'vitest',", "  plugins: ['@stryker-mutator/vitest-runner']", '}', ''].join(
        '\n'
      )
    )
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const cfg = readFileSync(target, 'utf8')
    expect(cfg).toContain("plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']")
    expect(cfg).toContain("ignorers: ['vue-macros']")
    // існуючий vitest-runner не дублюється
    expect(cfg.match(/@stryker-mutator\/vitest-runner/gu)).toHaveLength(1)
    proj.cleanup()
  })

  test('augment(d): non-vue root зі старим config — augment не викликається, файл не торкнутий', async () => {
    const proj = makeProj({ rules: ['js'] })
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, STRYKER_BASELINE)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(STRYKER_BASELINE)
    expect(readFileSync(target, 'utf8')).not.toContain('ignorers:')
    proj.cleanup()
  })

  test('augment(e): idempotency — другий прогон no-op, byte-identical після першого augment', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'App.vue'), '<template><div/></template>')
    const target = join(proj.dir, 'stryker.config.mjs')
    writeFileSync(target, STRYKER_BASELINE)
    await runCheckIn(proj.dir)
    const afterFirst = readFileSync(target, 'utf8')
    expect(afterFirst).toContain("ignorers: ['vue-macros']")
    await runCheckIn(proj.dir)
    expect(readFileSync(target, 'utf8')).toBe(afterFirst)
    proj.cleanup()
  })

  test('augment(f): non-literal export default (factory) — fail, файл не змінено', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'App.vue'), '<template><div/></template>')
    const target = join(proj.dir, 'stryker.config.mjs')
    const original = "export default defineConfig({ testRunner: 'vitest' })\n"
    writeFileSync(target, original)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(1)
    expect(readFileSync(target, 'utf8')).toBe(original)
    proj.cleanup()
  })

  test('augment(g): syntax error у config — fail, файл не змінено', async () => {
    const proj = makeProj({ rules: ['js'] })
    mkdirSync(join(proj.dir, 'src'), { recursive: true })
    writeFileSync(join(proj.dir, 'src', 'App.vue'), '<template><div/></template>')
    const target = join(proj.dir, 'stryker.config.mjs')
    const original = 'export default { testRunner: '
    writeFileSync(target, original)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(1)
    expect(readFileSync(target, 'utf8')).toBe(original)
    proj.cleanup()
  })
})
