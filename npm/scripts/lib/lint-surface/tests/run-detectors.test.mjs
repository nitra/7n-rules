// cspell:ignore manifest — навмисний тайпо-фікстур для перевірки "did you mean" у filterByDisabledConcerns
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { detectAll } from '../run-detectors.mjs'
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
const UNKNOWN_CONCERN_ERROR_RE = /невідомий concern.*manifest.*мали на увазі.*manifests/s

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

describe('detectAll — часткове вимикання concern-ів (rule/concern у disable-rules)', () => {
  test('вимкнений лише один concern не запускається, інший того ж rule — так', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body = "export function lint() { return { violations: [{ reason: 'probe', message: 'ran' }] } }\n"
      await seedDetector(rulesDir, 'k8s', 'network_policy', { scope: 'full', glob: ['**/*'] }, body)
      await seedDetector(rulesDir, 'k8s', 'manifests', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), {
        rules: ['k8s'],
        'disable-rules': ['k8s/network_policy'],
        'disable-rules-meta': { 'k8s/network_policy': { reason: 'legacy' } }
      })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      const ranConcerns = r.ran.map(e => e.concern.name).toSorted()
      expect(ranConcerns).toEqual(['manifests'])
    })
  })

  test('rule-level disable-rules вимикає всі concern-и rule (без регресії)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body = 'export function lint() { return { violations: [] } }\n'
      await seedDetector(rulesDir, 'k8s', 'network_policy', { scope: 'full', glob: ['**/*'] }, body)
      await seedDetector(rulesDir, 'k8s', 'manifests', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['k8s'], 'disable-rules': ['k8s'] })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.ran).toEqual([])
    })
  })

  test('невідомий concern у disable-rules → detect кидає гучну помилку', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body = 'export function lint() { return { violations: [] } }\n'
      await seedDetector(rulesDir, 'k8s', 'manifests', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), {
        rules: ['k8s'],
        'disable-rules': ['k8s/manifest'],
        'disable-rules-meta': { 'k8s/manifest': { reason: 'typo' } }
      })
      await expect(
        detectAll({
          rulesDir,
          cwd: dir,
          full: true,
          log: () => {
            /* no-op */
          }
        })
      ).rejects.toThrow(UNKNOWN_CONCERN_ERROR_RE)
    })
  })

  test('усі concern-и rule вимкнені частково → no-op без crash', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const body = 'export function lint() { return { violations: [] } }\n'
      await seedDetector(rulesDir, 'k8s', 'manifests', { scope: 'full', glob: ['**/*'] }, body)
      await writeJson(join(dir, '.n-rules.json'), {
        rules: ['k8s'],
        'disable-rules': ['k8s/manifests'],
        'disable-rules-meta': { 'k8s/manifests': { reason: 'x' } }
      })
      const r = await detectAll({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op */
        }
      })
      expect(r.exitCode).toBe(0)
      expect(r.ran).toEqual([])
    })
  })
})
