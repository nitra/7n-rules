import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runConcernDetector } from '../detect.mjs'
import { withTmpDir } from '../../../utils/test-helpers.mjs'

describe('runConcernDetector — policy-concern без main.mjs', () => {
  test('required:single відсутній → policy-file-missing, без main.mjs на диску', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'ga', 'lint_ga')
      await mkdir(concernDir, { recursive: true })
      const concern = {
        name: 'lint_ga',
        dir: concernDir,
        policy: {
          engine: 'rego',
          files: { single: '.github/workflows/lint-ga.yml', required: true },
          missingMessage: 'не існує'
        }
      }
      const r = await runConcernDetector(concern, { cwd: dir, ruleId: 'ga', concernId: 'lint_ga' })
      expect(r.violations).toEqual([
        {
          ruleId: 'ga',
          concernId: 'lint_ga',
          reason: 'policy-file-missing',
          message: 'не існує',
          severity: 'error',
          file: '.github/workflows/lint-ga.yml'
        }
      ])
    })
  })

  test('policy без резолвних files і без main.mjs → DetectorError', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'k8s', 'lib')
      await mkdir(concernDir, { recursive: true })
      const concern = { name: 'lib', dir: concernDir, policy: { engine: 'rego', files: undefined } }
      await expect(runConcernDetector(concern, { cwd: dir, ruleId: 'k8s', concernId: 'lib' })).rejects.toThrow(
        'немає main.mjs'
      )
    })
  })
})

describe('runConcernDetector — fail-open на ToolProvisionError', () => {
  test('lint() кидає ToolProvisionError → порожні violations + warn-діагностика, без DetectorError', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'ga', 'lint_ga')
      await mkdir(concernDir, { recursive: true })
      // Помилка розпізнається за name — саме так вона приходить з іншого інстансу ensure-tool.mjs
      await writeFile(
        join(concernDir, 'main.mjs'),
        "export function lint() { const e = new Error('GitHub API: tag_name missing for open-policy-agent/conftest'); e.name = 'ToolProvisionError'; throw e }\n",
        'utf8'
      )
      const concern = { name: 'lint_ga', dir: concernDir }
      const r = await runConcernDetector(concern, { cwd: dir, ruleId: 'ga', concernId: 'lint_ga' })
      expect(r.violations).toEqual([])
      expect(r.diagnostics).toHaveLength(1)
      expect(r.diagnostics[0].level).toBe('warn')
      expect(r.diagnostics[0].message).toContain('пропущено')
      expect(r.diagnostics[0].message).toContain('tag_name missing')
    })
  })

  test('звичайна помилка lint() далі кидає DetectorError (fail-open лише для ToolProvisionError)', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'ga', 'lint_ga')
      await mkdir(concernDir, { recursive: true })
      await writeFile(join(concernDir, 'main.mjs'), "export function lint() { throw new Error('boom') }\n", 'utf8')
      const concern = { name: 'lint_ga', dir: concernDir }
      await expect(runConcernDetector(concern, { cwd: dir, ruleId: 'ga', concernId: 'lint_ga' })).rejects.toThrow(
        'lint() кинув: boom'
      )
    })
  })
})

describe('runConcernDetector — ручний main.mjs як escape-hatch', () => {
  test('ручний (не-@generated) main.mjs перекриває policy-adapter', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'k8s', 'manifest')
      await mkdir(concernDir, { recursive: true })
      await writeFile(
        join(concernDir, 'main.mjs'),
        "export function lint() { return { violations: [{ reason: 'custom', message: 'x' }] } }\n",
        'utf8'
      )
      const concern = {
        name: 'manifest',
        dir: concernDir,
        policy: { engine: 'rego', files: { walkGlob: 'k8s/**/*.yaml' } }
      }
      const r = await runConcernDetector(concern, { cwd: dir, ruleId: 'k8s', concernId: 'manifest' })
      expect(r.violations[0].reason).toBe('custom')
    })
  })

  test('застарілий @generated main.mjs ігнорується — оцінка все одно напряму з concern.json', async () => {
    await withTmpDir(async dir => {
      const concernDir = join(dir, 'rules', 'ga', 'git_ai')
      await mkdir(concernDir, { recursive: true })
      const targetFile = join(dir, '.github', 'workflows', 'git-ai.yml')
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(targetFile, 'name: git-ai\n', 'utf8')
      await writeFile(
        join(concernDir, 'main.mjs'),
        "// @generated — do not edit\nexport function lint() { throw new Error('stale codegen artifact must not run') }\n",
        'utf8'
      )
      const concern = {
        name: 'git_ai',
        dir: concernDir,
        // engine:'template' без template/ каталогу → evaluatePolicyConcern повертає 0 violations
        // без спроби реального conftest — саме тому цей тест і детермінований.
        policy: { engine: 'template', files: { single: '.github/workflows/git-ai.yml', required: true } }
      }
      const r = await runConcernDetector(concern, { cwd: dir, ruleId: 'ga', concernId: 'git_ai' })
      expect(r.violations).toEqual([])
    })
  })
})
