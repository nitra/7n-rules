import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildDetectPlan, computeActiveDomains, detectAll } from '../run-detectors.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

/**
 * Створює concern із заданим тілом lint(ctx) у tmp rulesDir.
 * @param {string} rulesDir корінь tmp rulesDir
 * @param {string} rule id правила
 * @param {string} concern id concern-а
 * @param {object} lintSurface lint-блок concern.json
 * @param {string} lintBody тіло main.mjs (рядок із `export function lint(ctx){...}`)
 */
async function seedDetector(rulesDir, rule, concern, lintSurface, lintBody) {
  const dir = join(rulesDir, rule, concern)
  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, 'concern.json'), { lint: lintSurface })
  await writeFile(join(dir, 'main.mjs'), lintBody, 'utf8')
}

const CLEAN = 'export function lint() { return { violations: [] } }\n'

describe('detectAll — exit codes', () => {
  test('clean → exit 0', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'full', glob: ['**/*'] }, CLEAN)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.exitCode).toBe(0)
      expect(r.violations).toEqual([])
    })
  })

  test('violations → exit 1, ruleId/concernId домішані з ctx', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body =
        'export function lint(ctx) {\n' +
        "  return { violations: [{ reason: 'missing', message: 'no file', file: 'a/b.txt' }] }\n" +
        '}\n'
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.exitCode).toBe(1)
      expect(r.violations).toHaveLength(1)
      expect(r.violations[0]).toMatchObject({
        ruleId: 'probe',
        concernId: 'check',
        reason: 'missing',
        message: 'no file',
        file: 'a/b.txt',
        severity: 'error'
      })
    })
  })

  test('detector кидає → exit 2', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body = "export function lint() { throw new Error('boom') }\n"
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.exitCode).toBe(2)
    })
  })

  test('невалідний violation (без reason) → exit 2', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body = "export function lint() { return { violations: [{ message: 'x' }] } }\n"
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.exitCode).toBe(2)
    })
  })

  test('absolute file-path відхиляється → exit 2', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body =
        "export function lint() { return { violations: [{ reason: 'x', message: 'y', file: '/etc/passwd' }] } }\n"
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.exitCode).toBe(2)
    })
  })
})

describe('detectAll — scoping', () => {
  test('scoped rule запускає concern whole-repo (files=undefined)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body =
        'export function lint(ctx) {\n' +
        "  const f = ctx.files === undefined ? 'whole' : String(ctx.files.length)\n" +
        "  return { violations: [{ reason: 'probe', message: f }] }\n" +
        '}\n'
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'per-file', glob: ['**/*.mjs'] }, body)
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        rules: ['probe'],
        log: () => {
          /* no-op */
        }
      })
      expect(r.violations[0].message).toBe('whole')
    })
  })

  test('explicit files: per-file concern отримує відфільтрований список', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body =
        'export function lint(ctx) {\n' +
        "  return { violations: [{ reason: 'probe', message: (ctx.files || []).join(',') }] }\n" +
        '}\n'
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'per-file', glob: ['**/*.mjs'] }, body)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        files: ['a.mjs', 'b.txt', 'c.mjs'],
        log: () => {
          /* no-op */
        }
      })
      expect(r.violations[0].message).toBe('a.mjs,c.mjs')
    })
  })

  test('verbose логує concern, scope і кількість файлів', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      await seedDetector(rulesDir, 'probe', 'check', { scope: 'per-file', glob: ['**/*.mjs'] }, CLEAN)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
      const logs = []
      await detectAll({
        rulesDir,
        cwd: dir,
        files: ['a.mjs'],
        verbose: true,
        log: s => {
          logs.push(s)
        }
      })
      const line = logs.find(l => l.includes('probe/check'))
      expect(line).toBeDefined()
      expect(line).toContain('per-file')
      expect(line).toContain('1 файл')
    })
  })
})

describe('buildDetectPlan — сервіс-канон (scoped+files, pathMode, repoWide)', () => {
  /**
   * Сідить правило probe з per-file (glob *.js) і full-scope (glob *.js) concern-ами.
   * @param {string} dir tmp-корінь
   * @returns {Promise<string>} rulesDir
   */
  async function seedMixedRule(dir) {
    const rulesDir = join(dir, 'rules')
    await seedDetector(rulesDir, 'probe', 'perfile', { scope: 'per-file', glob: ['**/*.js'] }, CLEAN)
    await seedDetector(rulesDir, 'probe', 'wholerepo', { scope: 'full', glob: ['**/*.js'] }, CLEAN)
    await seedDetector(rulesDir, 'probe', 'noglob', { scope: 'full', glob: [] }, CLEAN)
    await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
    return rulesDir
  }

  test('scoped + files: лише per-file concerns × glob-збіги, full-scope виключені', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRule(dir)
      const plan = await buildDetectPlan({ rulesDir, cwd: dir, rules: ['probe'], files: ['a.js', 'b.txt'] })
      expect(plan).toHaveLength(1)
      expect(plan[0].entry.concern.name).toBe('perfile')
      expect(plan[0].files).toEqual(['a.js'])
    })
  })

  test('scoped + files: невідомий rule-id → порожній план', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRule(dir)
      const plan = await buildDetectPlan({ rulesDir, cwd: dir, rules: ['nope'], files: ['a.js'] })
      expect(plan).toEqual([])
    })
  })

  test('pathMode: full-scope concerns виключені; без pathMode full+glob тригериться whole-repo', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRule(dir)
      const withPathMode = await buildDetectPlan({ rulesDir, cwd: dir, files: ['x.js'], pathMode: true })
      expect(withPathMode.map(p => p.entry.concern.name)).toEqual(['perfile'])
      const withoutPathMode = await buildDetectPlan({ rulesDir, cwd: dir, files: ['x.js'] })
      expect(withoutPathMode.map(p => p.entry.concern.name)).toEqual(['perfile', 'wholerepo'])
      expect(withoutPathMode[1].files).toBeUndefined()
    })
  })

  test('repoWide: лише full-scope concerns enabled-правил (включно з noglob), whole-repo', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRule(dir)
      await seedDetector(rulesDir, 'disabled', 'full', { scope: 'full', glob: [] }, CLEAN)
      const plan = await buildDetectPlan({ rulesDir, cwd: dir, repoWide: true })
      expect(plan.map(p => `${p.entry.ruleId}/${p.entry.concern.name}`)).toEqual(['probe/noglob', 'probe/wholerepo'])
      for (const p of plan) expect(p.files).toBeUndefined()
    })
  })
})

describe('computeActiveDomains', () => {
  const byRule = {
    js: [
      { name: 'eslint', lint: { scope: 'per-file', glob: ['**/*.js'] } },
      { name: 'knip', lint: { scope: 'full', glob: [] } }
    ],
    python: [{ name: 'ruff', lint: { scope: 'per-file', glob: ['**/*.py'] } }],
    'npm-module': [{ name: 'pkg', lint: { scope: 'full', glob: ['**/package.json'] } }]
  }
  const enabled = new Set(['js', 'python', 'npm-module'])

  test('домен активний лише при glob-збігу per-file concern-а', () => {
    const map = computeActiveDomains(byRule, enabled, ['src/a.js', 'README.md'])
    expect(map.get('js')).toEqual({ triggered: true, matchedFiles: 1 })
    expect(map.get('python')).toEqual({ triggered: false, matchedFiles: 0 })
  })

  test('правила без per-file concerns не потрапляють у результат', () => {
    const map = computeActiveDomains(byRule, enabled, ['package.json'])
    expect(map.has('npm-module')).toBe(false)
  })

  test('disabled-правило не потрапляє', () => {
    const map = computeActiveDomains(byRule, new Set(['js']), ['src/a.py'])
    expect(map.has('python')).toBe(false)
  })
})

describe('detectAll — N_RULES_LINT_CONCURRENCY (ADR 260716-1354)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('стабільне сортування незалежно від порядку завершення (concurrency>1)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      // 'aaa-slow' відсортується ПЕРШИМ за ruleId, хоча завершується ОСТАННІМ — сортування
      // не покладається на порядок завершення concurrent-задач.
      const slowBody =
        'export async function lint() {\n' +
        '  await new Promise(r => setTimeout(r, 30))\n' +
        "  return { violations: [{ reason: 'r', message: 'slow' }] }\n" +
        '}\n'
      const fastBody =
        'export async function lint() {\n' +
        '  await new Promise(r => setTimeout(r, 5))\n' +
        "  return { violations: [{ reason: 'r', message: 'fast' }] }\n" +
        '}\n'
      await seedDetector(rulesDir, 'aaa-slow', 'check', { scope: 'full', glob: ['**/*'] }, slowBody)
      await seedDetector(rulesDir, 'zzz-fast', 'check', { scope: 'full', glob: ['**/*'] }, fastBody)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['aaa-slow', 'zzz-fast'] })

      vi.stubEnv('N_RULES_LINT_CONCURRENCY', '2')
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })

      expect(r.exitCode).toBe(1)
      expect(r.violations.map(v => v.ruleId)).toEqual(['aaa-slow', 'zzz-fast'])
    })
  })

  test('DetectorError у concurrent режимі → exit 2, зберігає violations уже завершених concern-ів', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const okBody =
        'export async function lint() {\n' +
        '  await new Promise(r => setTimeout(r, 5))\n' +
        "  return { violations: [{ reason: 'ok', message: 'fine' }] }\n" +
        '}\n'
      const boomBody =
        "export async function lint() {\n  await new Promise(r => setTimeout(r, 20))\n  throw new Error('boom')\n}\n"
      await seedDetector(rulesDir, 'aaa-ok', 'check', { scope: 'full', glob: ['**/*'] }, okBody)
      await seedDetector(rulesDir, 'zzz-boom', 'check', { scope: 'full', glob: ['**/*'] }, boomBody)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['aaa-ok', 'zzz-boom'] })

      vi.stubEnv('N_RULES_LINT_CONCURRENCY', '2')
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })

      expect(r.exitCode).toBe(2)
      expect(r.ran.map(e => e.ruleId)).toEqual(['aaa-ok'])
      expect(r.violations).toHaveLength(1)
      expect(r.violations[0].message).toBe('fine')
    })
  })
})
