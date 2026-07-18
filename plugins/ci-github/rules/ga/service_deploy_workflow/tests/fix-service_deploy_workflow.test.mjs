/**
 * Тести T0-автоміграції GA deploy-workflow до канону (fix-service_deploy_workflow.mjs):
 * легасі workflow (job lint із `--path` без домену, test, deploy) переписується у форму
 * plan → lint-<domain> → deploy, і мігрований YAML проходить власний rego-концерн
 * service_deploy_workflow (conftest) без deny — «фіксер ↔ канон не дрейфують».
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'

import { migrateWorkflowFile } from '../fix-service_deploy_workflow.mjs'
import { withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'
import { runConftestBatch } from '@7n/rules/scripts/lib/run-conftest-batch.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const LEGACY_WORKFLOW = `# legacy deploy workflow
name: Deploy nexus

on:
  push:
    branches:
      - dev
      - main
    paths:
      - 'run/nexus/**'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: ./.github/actions/setup-bun-deps

      - run: bunx n-rules lint --path run/nexus --no-fix

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: ./.github/actions/setup-bun-deps

      - run: bun test run/nexus

  deploy:
    needs:
      - lint
      - test
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
`

/**
 * Консюмер-фікстура: сервіс run/nexus (js+md), enabled-правила js/text.
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} абсолютний шлях workflow-файлу
 */
async function seedConsumer(dir) {
  await mkdir(join(dir, 'run', 'nexus'), { recursive: true })
  await writeFile(join(dir, 'run', 'nexus', 'index.js'), 'export const a = 1\n', 'utf8')
  await writeFile(join(dir, 'run', 'nexus', 'readme.md'), '# nexus\n', 'utf8')
  await writeJson(join(dir, '.n-rules.json'), { rules: ['js', 'text'] })
  const wfDir = join(dir, '.github', 'workflows')
  await mkdir(wfDir, { recursive: true })
  const abs = join(wfDir, 'deploy-nexus.yml')
  await writeFile(abs, LEGACY_WORKFLOW, 'utf8')
  return abs
}

describe('migrateWorkflowFile — легасі GA deploy-workflow', () => {
  test('переписує до канону: plan з outputs, per-domain lint-джоби, перешитий needs, Skipped-толерантний if', async () => {
    await withTmpDir(async dir => {
      const abs = await seedConsumer(dir)
      expect(await migrateWorkflowFile(abs, dir)).toBe(true)

      const js = parse(await readFile(abs, 'utf8'))
      const jobs = js.jobs

      // plan: перший ключ, outputs-мапінг доменів + any, id: plan, fetch-depth: 0
      expect(Object.keys(jobs)[0]).toBe('plan')
      expect(jobs.plan.outputs.js).toBe(`\${{ steps.plan.outputs.js }}`)
      expect(jobs.plan.outputs.any).toBe(`\${{ steps.plan.outputs.any }}`)
      const planStep = jobs.plan.steps.at(-1)
      expect(planStep.id).toBe('plan')
      expect(planStep.run).toBe('bunx n-rules ci plan --path run/nexus --github')
      expect(jobs.plan.steps[0].with['fetch-depth']).toBe(0)

      // легасі lint зник; per-domain джоби js/text
      expect(jobs.lint).toBeUndefined()
      expect(jobs['lint-js']).toMatchObject({ needs: 'plan', if: "needs.plan.outputs.js == 'true'" })
      expect(jobs['lint-js'].steps.at(-1).run).toBe('bunx n-rules lint js --path run/nexus --no-fix')
      expect(jobs['lint-text']).toBeDefined()

      // deploy: needs перешито + plan, канонічний if
      expect(jobs.deploy.needs).toEqual(['plan', 'lint-js', 'lint-text', 'test'])
      expect(jobs.deploy.if).toContain('!cancelled()')
      expect(jobs.deploy.if).toContain("!contains(needs.*.result, 'failure')")

      // коментар шапки збережено
      expect(await readFile(abs, 'utf8')).toContain('# legacy deploy workflow')
    })
  })

  test('мігрований YAML проходить власний rego-концерн без deny (conftest)', async () => {
    await withTmpDir(async dir => {
      const abs = await seedConsumer(dir)
      await migrateWorkflowFile(abs, dir)
      const denies = await runConftestBatch({
        policyDirRel: 'ga/service_deploy_workflow',
        policyDirAbs: CONCERN_DIR,
        namespace: 'ga.service_deploy_workflow',
        files: [abs]
      })
      expect(denies).toEqual([])
    })
  })

  test('ідемпотентність: повторний прогін не змінює файл', async () => {
    await withTmpDir(async dir => {
      const abs = await seedConsumer(dir)
      await migrateWorkflowFile(abs, dir)
      const once = await readFile(abs, 'utf8')
      expect(await migrateWorkflowFile(abs, dir)).toBe(false)
      expect(await readFile(abs, 'utf8')).toBe(once)
    })
  })

  test('workflow без сервісного шляху (немає lint --path і paths) — не чіпається', async () => {
    await withTmpDir(async dir => {
      const wfDir = join(dir, '.github', 'workflows')
      await mkdir(wfDir, { recursive: true })
      const abs = join(wfDir, 'deploy-x.yml')
      const src =
        'on:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo deploy\n'
      await writeFile(abs, src, 'utf8')
      expect(await migrateWorkflowFile(abs, dir)).toBe(false)
      expect(await readFile(abs, 'utf8')).toBe(src)
    })
  })
})
