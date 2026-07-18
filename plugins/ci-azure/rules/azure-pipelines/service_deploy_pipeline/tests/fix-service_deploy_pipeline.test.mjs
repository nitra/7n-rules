/**
 * Тести T0-автоміграції легасі сервіс-pipeline до канону (fix-service_deploy_pipeline.mjs):
 * efes-подібна фікстура (job lint із `--path` без домену, run_tests, build_and_push,
 * ланцюговий deploy) переписується у форму plan → lint_<domain> → deploy, і мігрований
 * YAML проходить власний rego-концерн service_deploy_pipeline (conftest) без deny —
 * золота перевірка «фіксер ↔ канон не дрейфують».
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'

import { migratePipelineFile } from '../fix-service_deploy_pipeline.mjs'
import { withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'
import { runConftestBatch } from '@7n/rules/scripts/lib/run-conftest-batch.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const LEGACY_PIPELINE = `# efes-style deploy pipeline
trigger:
  branches:
    include:
      - dev
      - main
  paths:
    include:
      - run/nexus

pool:
  vmImage: ubuntu-latest

jobs:
  - job: lint
    steps:
      - checkout: self
      - script: |
          curl -fsSL https://bun.sh/install | bash
          echo "##vso[task.prependpath]$HOME/.bun/bin"
        displayName: Install bun
      - script: bun install --frozen-lockfile
        displayName: Install deps
      - script: bunx n-rules lint --path run/nexus --no-fix
        displayName: Lint

  - job: run_tests
    steps:
      - checkout: self
      - script: bun install --frozen-lockfile
      - script: bun test run/nexus

  - job: build_and_push
    dependsOn:
      - lint
      - run_tests
    steps:
      - script: echo build

  - job: deploy_to_aks
    dependsOn: build_and_push
    steps:
      - script: echo deploy
`

/**
 * Консюмер-фікстура: git-like дерево з сервісом run/nexus (js+text файли),
 * fixture rulesDir у .n-rules.json недоступний — домени беруться з реального
 * DEFAULT_RULES_DIR, тому обмежуємо enabled-правила js/text.
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} абсолютний шлях pipeline-файлу
 */
async function seedConsumer(dir) {
  await mkdir(join(dir, 'run', 'nexus'), { recursive: true })
  await writeFile(join(dir, 'run', 'nexus', 'index.js'), 'export const a = 1\n', 'utf8')
  await writeFile(join(dir, 'run', 'nexus', 'readme.md'), '# nexus\n', 'utf8')
  await writeJson(join(dir, '.n-rules.json'), { rules: ['js', 'text'] })
  const pipelineDir = join(dir, '.azurepipelines')
  await mkdir(pipelineDir, { recursive: true })
  const abs = join(pipelineDir, 'run-nexus.yml')
  await writeFile(abs, LEGACY_PIPELINE, 'utf8')
  return abs
}

describe('migratePipelineFile — efes-подібний легасі pipeline', () => {
  test('переписує до канону: plan, per-domain lint-джоби, перешитий dependsOn, Skipped-толерантний condition', async () => {
    await withTmpDir(async dir => {
      const abs = await seedConsumer(dir)
      const changed = await migratePipelineFile(abs, dir)
      expect(changed).toBe(true)

      const js = parse(await readFile(abs, 'utf8'))
      const jobs = Object.fromEntries(js.jobs.map(j => [j.job, j]))

      // plan-джоба: перша, з name: plan, --azure і fetchDepth: 0
      expect(js.jobs[0].job).toBe('plan')
      const planStep = jobs.plan.steps.at(-1)
      expect(planStep.script).toContain('n-rules ci plan --path run/nexus --azure')
      expect(planStep.name).toBe('plan')
      expect(jobs.plan.steps[0]).toMatchObject({ checkout: 'self', fetchDepth: 0 })

      // легасі lint зник; per-domain джоби для js і text (файли піддерева)
      expect(jobs.lint).toBeUndefined()
      expect(jobs.lint_js).toMatchObject({
        dependsOn: 'plan',
        condition: "eq(dependencies.plan.outputs['plan.js'], 'true')"
      })
      expect(jobs.lint_js.steps.at(-1).script).toBe('bunx n-rules lint js --path run/nexus --no-fix')
      expect(jobs.lint_text).toBeDefined()

      // dependsOn build_and_push перешито з lint на нові джоби + plan; condition Skipped-толерантний
      expect(jobs.build_and_push.dependsOn).toEqual(['plan', 'lint_js', 'lint_text', 'run_tests'])
      expect(jobs.build_and_push.condition).toContain('not(canceled())')
      expect(jobs.build_and_push.condition).toContain("in(dependencies.lint_js.result, 'Succeeded', 'Skipped')")

      // ланцюговий deploy не чіпаємо (не залежить від lint-джоб напряму)
      expect(jobs.deploy_to_aks.dependsOn).toBe('build_and_push')

      // коментар шапки збережено (yaml Document API, не повний rewrite)
      expect(await readFile(abs, 'utf8')).toContain('# efes-style deploy pipeline')
    })
  })

  test('мігрований YAML проходить власний rego-концерн без deny (conftest)', async () => {
    await withTmpDir(async dir => {
      const abs = await seedConsumer(dir)
      await migratePipelineFile(abs, dir)
      const denies = await runConftestBatch({
        policyDirRel: 'azure-pipelines/service_deploy_pipeline',
        policyDirAbs: CONCERN_DIR,
        namespace: 'azure_pipelines.service_deploy_pipeline',
        files: [abs]
      })
      expect(denies).toEqual([])
    })
  })

  test('ідемпотентність: повторний прогін не змінює файл', async () => {
    await withTmpDir(async dir => {
      const abs = await seedConsumer(dir)
      await migratePipelineFile(abs, dir)
      const once = await readFile(abs, 'utf8')
      const changedAgain = await migratePipelineFile(abs, dir)
      expect(changedAgain).toBe(false)
      expect(await readFile(abs, 'utf8')).toBe(once)
    })
  })

  test('repo-wide pipeline без trigger.paths — не чіпається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.azurepipelines'), { recursive: true })
      const abs = join(dir, '.azurepipelines', 'repo-lint.yml')
      const src =
        'trigger:\n  branches:\n    include: [dev, main]\njobs:\n  - job: lint\n    steps:\n      - script: bunx n-rules lint --no-fix --full\n'
      await writeFile(abs, src, 'utf8')
      expect(await migratePipelineFile(abs, dir)).toBe(false)
      expect(await readFile(abs, 'utf8')).toBe(src)
    })
  })

  test('task-форма (Bash@3 inputs.script): легасі lint мігрується, мігрований YAML проходить rego', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'run', 'nexus'), { recursive: true })
      await writeFile(join(dir, 'run', 'nexus', 'index.js'), 'export const a = 1\n', 'utf8')
      await writeJson(join(dir, '.n-rules.json'), { rules: ['js'] })
      await mkdir(join(dir, '.azurepipelines'), { recursive: true })
      const abs = join(dir, '.azurepipelines', 'run-nexus.yml')
      const src = [
        'trigger:',
        '  paths:',
        '    include:',
        '      - run/nexus/**',
        'jobs:',
        '  - job: lint',
        '    steps:',
        '      - checkout: self',
        '      - task: Bash@3',
        '        displayName: Install root dependencies and lint module',
        '        inputs:',
        '          targetType: inline',
        '          script: |',
        '            set -euo pipefail',
        '            bun install --frozen-lockfile',
        '            bunx n-rules lint --path run/nexus --no-fix',
        '  - job: build_and_push',
        '    dependsOn:',
        '      - lint',
        '    steps:',
        '      - script: echo build',
        ''
      ].join('\n')
      await writeFile(abs, src, 'utf8')

      expect(await migratePipelineFile(abs, dir)).toBe(true)
      const js = parse(await readFile(abs, 'utf8'))
      const jobs = Object.fromEntries(js.jobs.map(j => [j.job, j]))
      expect(jobs.plan).toBeDefined()
      expect(jobs.lint).toBeUndefined()
      expect(jobs.lint_js).toBeDefined()
      expect(jobs.build_and_push.dependsOn).toEqual(['plan', 'lint_js'])

      const denies = await runConftestBatch({
        policyDirRel: 'azure-pipelines/service_deploy_pipeline',
        policyDirAbs: CONCERN_DIR,
        namespace: 'azure_pipelines.service_deploy_pipeline',
        files: [abs]
      })
      expect(denies).toEqual([])
    })
  })

  test('template-розкладка — не чіпається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.azurepipelines'), { recursive: true })
      const abs = join(dir, '.azurepipelines', 'run-tpl.yml')
      const src =
        'trigger:\n  paths:\n    include: [run/nexus]\njobs:\n  - template: templates/deploy.yml\n    parameters:\n      modulePath: run/nexus\n'
      await writeFile(abs, src, 'utf8')
      expect(await migratePipelineFile(abs, dir)).toBe(false)
    })
  })
})
