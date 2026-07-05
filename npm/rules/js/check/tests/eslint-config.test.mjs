/**
 * Тести eslint-config.mjs + fix-check.mjs: детекція воркспейс-типів (node/vue),
 * scaffold відсутнього eslint.config.js, хірургічний merge наявного (без повного
 * перезапису) і detector-перевірка vue-воркспейсів у vue: [...] getConfig.
 * Репро інциденту: у vue-монорепо (workspaces: ['app']) фіксер записав
 * `getConfig({ node: ['npm'] })` — .vue файли перестали оброблятись eslint-ом.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { detectWorkspaceTypes, mergeEslintConfig, parseVueList, planEslintConfigFix } from '../eslint-config.mjs'
import { patterns } from '../fix-check.mjs'
import { lint } from '../main.mjs'

/**
 * Мінімальне vue-монорепо: root package.json з workspaces: ['app'],
 * app/package.json із vue-залежністю та app/src/App.vue.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<void>}
 */
async function makeVueMonorepo(dir) {
  await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'], type: 'module' }), 'utf8')
  await mkdir(join(dir, 'app', 'src'), { recursive: true })
  await writeFile(
    join(dir, 'app', 'package.json'),
    JSON.stringify({ name: 'app', type: 'module', dependencies: { vue: '^3.0.0' } }),
    'utf8'
  )
  await writeFile(join(dir, 'app', 'src', 'App.vue'), '<template><div /></template>\n', 'utf8')
}

/**
 * Порушення js/check у whole-repo режимі.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} порушення
 */
async function checkViolations(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'js', concernId: 'check', files: undefined })
  return violations
}

const { withTmpDir } = await import('../../../../scripts/utils/test-helpers.mjs')
const noAppInNodeWorkspaceRe = /node:[^\]]*'app'/u

describe('detectWorkspaceTypes', () => {
  test('vue-монорепо (vue-залежність у workspace) → vue: [app]', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      expect(await detectWorkspaceTypes(dir)).toEqual({ node: [], vue: ['app'] })
    })
  })

  test('змішане монорепо: .vue файли без vue-залежності + node-воркспейс', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app', 'scripts'] }), 'utf8')
      await mkdir(join(dir, 'app', 'src'), { recursive: true })
      await writeFile(join(dir, 'app', 'src', 'App.vue'), '<template><div /></template>\n', 'utf8')
      await mkdir(join(dir, 'scripts'), { recursive: true })
      await writeFile(join(dir, 'scripts', 'run.mjs'), 'export {}\n', 'utf8')
      expect(await detectWorkspaceTypes(dir)).toEqual({ node: ['scripts'], vue: ['app'] })
    })
  })

  test('glob-workspaces (packages/*) розгортаються у директорії', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }), 'utf8')
      await mkdir(join(dir, 'packages', 'web'), { recursive: true })
      await writeFile(
        join(dir, 'packages', 'web', 'package.json'),
        JSON.stringify({ devDependencies: { vue: '^3.0.0' } }),
        'utf8'
      )
      await mkdir(join(dir, 'packages', 'cli'), { recursive: true })
      expect(await detectWorkspaceTypes(dir)).toEqual({ node: ['packages/cli'], vue: ['packages/web'] })
    })
  })

  test('без workspaces: .vue у корені → vue: [.]', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src', 'App.vue'), '<template><div /></template>\n', 'utf8')
      expect(await detectWorkspaceTypes(dir)).toEqual({ node: [], vue: ['.'] })
    })
  })

  test('без workspaces і без .vue → node: [.]', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'index.mjs'), 'export {}\n', 'utf8')
      expect(await detectWorkspaceTypes(dir)).toEqual({ node: ['.'], vue: [] })
    })
  })
})

describe('planEslintConfigFix — scaffold відсутнього конфігу', () => {
  test('vue-монорепо → шаблон із vue: [app], без вигаданих node-записів', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      const plan = await planEslintConfigFix(dir)
      expect(plan).not.toBeNull()
      expect(plan?.path).toBe(join(dir, 'eslint.config.js'))
      expect(plan?.content).toContain("vue: ['app']")
      expect(plan?.content).not.toContain('node:')
      expect(plan?.content).toContain('**/auto-imports.d.ts')
      expect(plan?.content).toContain("import { getConfig } from '@nitra/eslint-config'")
    })
  })
})

describe('mergeEslintConfig — merge наявного конфігу, не перезапис', () => {
  const incidentConfig = [
    "import { getConfig } from '@nitra/eslint-config'",
    '',
    'export default [',
    '  {',
    "    ignores: ['**/auto-imports.d.ts', 'app/src-tauri/**', 'docs/**']",
    '  },',
    '  ...getConfig({',
    "    node: ['npm']",
    '  })',
    ']',
    ''
  ].join('\n')

  test('інцидент-репро: node-шаблон у vue-монорепо → vue: [app] додано, кастомні ignores збережено', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      await writeFile(join(dir, 'eslint.config.js'), incidentConfig, 'utf8')
      const plan = await planEslintConfigFix(dir)
      expect(plan).not.toBeNull()
      expect(parseVueList(plan?.content ?? '')).toContain('app')
      // merge, не перезапис: кастомний ignore і структура файлу на місці
      expect(plan?.content).toContain("'app/src-tauri/**'")
      expect(plan?.content).toContain("import { getConfig } from '@nitra/eslint-config'")
    })
  })

  test('vue-воркспейс помилково у node: [...] → переїздить у vue: [...]', () => {
    const raw = incidentConfig.replace("node: ['npm']", "node: ['app', 'scripts']")
    const merged = mergeEslintConfig(raw, { node: ['scripts'], vue: ['app'] })
    expect(parseVueList(merged)).toContain('app')
    expect(merged).toContain("node: ['scripts']")
    expect(merged).not.toMatch(noAppInNodeWorkspaceRe)
  })

  test('відсутній auto-imports у ignores → дописується без втрати решти', () => {
    const raw = incidentConfig.replace("'**/auto-imports.d.ts', ", '')
    const merged = mergeEslintConfig(raw, { node: [], vue: [] })
    expect(merged).toContain('**/auto-imports.d.ts')
    expect(merged).toContain("'app/src-tauri/**'")
  })

  test('коректний конфіг → план null (ідемпотентність)', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      await writeFile(join(dir, 'eslint.config.js'), incidentConfig.replace("node: ['npm']", "vue: ['app']"), 'utf8')
      expect(await planEslintConfigFix(dir)).toBeNull()
    })
  })

  test('нерозпізнана структура (без getConfig) → файл не чіпається (fail-safe)', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      await writeFile(join(dir, 'eslint.config.js'), 'export default []\n', 'utf8')
      expect(await planEslintConfigFix(dir)).toBeNull()
    })
  })
})

describe('detector — vue-воркспейс має бути у vue: [...]', () => {
  test('npm-варіант конфігу у vue-монорепо → порушення eslint-config-vue-workspace', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      await writeFile(
        join(dir, 'eslint.config.js'),
        "import { getConfig } from '@nitra/eslint-config'\n" +
          "export default [{ ignores: ['**/auto-imports.d.ts'] }, ...getConfig({ node: ['npm'] })]\n",
        'utf8'
      )
      const reasons = await checkViolations(dir)
      expect(reasons.map(v => v.reason)).toContain('eslint-config-vue-workspace')
    })
  })

  test('коректний vue-конфіг → без eslint-config-* порушень', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      await writeFile(
        join(dir, 'eslint.config.js'),
        "import { getConfig } from '@nitra/eslint-config'\n" +
          "export default [{ ignores: ['**/auto-imports.d.ts'] }, ...getConfig({ vue: ['app'] })]\n",
        'utf8'
      )
      const reasons = await checkViolations(dir)
      expect(reasons.map(v => v.reason).filter(r => String(r).startsWith('eslint-config'))).toEqual([])
    })
  })
})

describe('fix-check T0 — повний цикл', () => {
  test('відсутній конфіг у vue-монорепо → створено з vue: [app], re-detect чистий по eslint-config', async () => {
    await withTmpDir(async dir => {
      await makeVueMonorepo(dir)
      const before = await checkViolations(dir)
      expect(patterns[0].test(before)).toBe(true)
      const res = await patterns[0].apply(before, { cwd: dir, ruleId: 'js', concernId: 'check' })
      expect(res.touchedFiles).toHaveLength(1)
      expect(existsSync(join(dir, 'eslint.config.js'))).toBe(true)
      const written = await readFile(join(dir, 'eslint.config.js'), 'utf8')
      expect(parseVueList(written)).toEqual(['app'])
      const after = await checkViolations(dir)
      expect(after.map(v => v.reason).filter(r => String(r).startsWith('eslint-config'))).toEqual([])
    })
  })

  test('T0 не тригериться на порушення інших перевірок js/check', () => {
    expect(patterns[0].test([{ reason: 'check', message: 'engines' }])).toBe(false)
  })
})
