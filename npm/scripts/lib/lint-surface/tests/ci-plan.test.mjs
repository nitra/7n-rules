import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { computeCiPlan, renderCiPlanGithubLines, renderCiPlanAzureLines, runCiPlanCli } from '../ci-plan.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

/**
 * Git-репо (main) + fixture rulesDir: правило js (per-file *.js), python
 * (per-file *.py), npm-module (per-file package.json), knip-подібний full-scope.
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} rulesDir
 */
async function seedRepo(dir) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  await mkdir(join(dir, 'svc'), { recursive: true })
  await writeFile(join(dir, 'svc', 'base.js'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })

  const rulesDir = join(dir, 'rules')
  const clean = 'export function lint() { return { violations: [] } }\n'
  const seed = async (rule, concern, lint) => {
    const cdir = join(rulesDir, rule, concern)
    await mkdir(cdir, { recursive: true })
    await writeJson(join(cdir, 'concern.json'), { lint })
    await writeFile(join(cdir, 'main.mjs'), clean, 'utf8')
  }
  await seed('js', 'eslint', { scope: 'per-file', glob: ['**/*.js'] })
  await seed('js', 'knip', { scope: 'full', glob: [] })
  await seed('python', 'ruff', { scope: 'per-file', glob: ['**/*.py'] })
  await seed('npm-module', 'pkg', { scope: 'per-file', glob: ['**/package.json'] })
  await writeJson(join(dir, '.n-rules.json'), { rules: ['js', 'python', 'npm-module'] })
  return rulesDir
}

describe('computeCiPlan', () => {
  test('домен true лише при glob-збігу в перетині; санітизація npm-module → npm_module', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedRepo(dir)
      await writeFile(join(dir, 'svc', 'new.js'), 'export const n = 1\n', 'utf8')
      await writeFile(join(dir, 'other.py'), 'x = 1\n', 'utf8')

      const plan = await computeCiPlan({ cwd: dir, pathArg: 'svc', rulesDir })

      expect(plan.baseResolved).toBe(true)
      expect(plan.hasChanges).toBe(true)
      const byId = Object.fromEntries(plan.domains.map(d => [d.id, d]))
      expect(byId.js).toMatchObject({ key: 'js', triggered: true, matchedFiles: 1 })
      // other.py поза --path → python не тригериться
      expect(byId.python).toMatchObject({ triggered: false, matchedFiles: 0 })
      expect(byId['npm-module']).toMatchObject({ key: 'npm_module', triggered: false })
    })
  })

  test('порожній перетин → усі false, hasChanges=false', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedRepo(dir)
      await writeFile(join(dir, 'other.py'), 'x = 1\n', 'utf8')

      const plan = await computeCiPlan({ cwd: dir, pathArg: 'svc', rulesDir })

      expect(plan.hasChanges).toBe(false)
      expect(plan.domains.every(d => !d.triggered)).toBe(true)
    })
  })

  test('база не резолвиться → fail-open: усі true, hasChanges=true', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedRepo(dir)
      // прибираємо main: перейменування гілки лишає репо без main/origin/main
      spawnSync('git', ['branch', '-m', 'main', 'trunk'], { cwd: dir })

      const plan = await computeCiPlan({ cwd: dir, pathArg: 'svc', rulesDir })

      expect(plan.baseResolved).toBe(false)
      expect(plan.hasChanges).toBe(true)
      expect(plan.changedCount).toBeNull()
      expect(plan.domains.length).toBeGreaterThan(0)
      expect(plan.domains.every(d => d.triggered)).toBe(true)
    })
  })

  test('has_tests: статична наявність тест-файлів у піддереві', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedRepo(dir)
      const before = await computeCiPlan({ cwd: dir, pathArg: 'svc', rulesDir })
      expect(before.hasTests).toBe(false)

      await writeFile(join(dir, 'svc', 'base.test.js'), 'export {}\n', 'utf8')
      const after = await computeCiPlan({ cwd: dir, pathArg: 'svc', rulesDir })
      expect(after.hasTests).toBe(true)
    })
  })

  test('без --path: дельта всього репо', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedRepo(dir)
      await writeFile(join(dir, 'other.py'), 'x = 1\n', 'utf8')

      const plan = await computeCiPlan({ cwd: dir, rulesDir })

      const byId = Object.fromEntries(plan.domains.map(d => [d.id, d]))
      expect(byId.python.triggered).toBe(true)
      expect(byId.js.triggered).toBe(false)
    })
  })

  test('full-scope-only домени не зʼявляються у плані взагалі', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedRepo(dir)
      const cdir = join(rulesDir, 'onlyfull', 'jscpd')
      await mkdir(cdir, { recursive: true })
      await writeJson(join(cdir, 'concern.json'), { lint: { scope: 'full', glob: [] } })
      await writeFile(join(cdir, 'main.mjs'), 'export function lint() { return { violations: [] } }\n', 'utf8')
      await writeJson(join(dir, '.n-rules.json'), { rules: ['js', 'onlyfull'] })
      await writeFile(join(dir, 'svc', 'new.js'), 'export {}\n', 'utf8')

      const plan = await computeCiPlan({ cwd: dir, pathArg: 'svc', rulesDir })

      expect(plan.domains.some(d => d.id === 'onlyfull')).toBe(false)
    })
  })
})

describe('рендерери outputs', () => {
  const plan = {
    path: 'svc',
    baseResolved: true,
    changedCount: 2,
    hasChanges: true,
    hasTests: false,
    domains: [
      { id: 'js', key: 'js', triggered: true, matchedFiles: 2 },
      { id: 'npm-module', key: 'npm_module', triggered: false, matchedFiles: 0 }
    ]
  }

  test('GitHub: точні name=value рядки', () => {
    expect(renderCiPlanGithubLines(plan)).toEqual([
      'js=true',
      'npm_module=false',
      'any=true',
      'has_tests=false',
      'domains=["js"]'
    ])
  })

  test('Azure: точні ##vso-рядки з isOutput=true', () => {
    expect(renderCiPlanAzureLines(plan)).toEqual([
      '##vso[task.setvariable variable=js;isOutput=true]true',
      '##vso[task.setvariable variable=npm_module;isOutput=true]false',
      '##vso[task.setvariable variable=any;isOutput=true]true',
      '##vso[task.setvariable variable=has_tests;isOutput=true]false',
      '##vso[task.setvariable variable=domains;isOutput=true]["js"]'
    ])
  })
})

describe('runCiPlanCli', () => {
  test('невідома підкоманда → 1', async () => {
    expect(await runCiPlanCli(['nope'])).toBe(1)
  })
})
