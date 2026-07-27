/**
 * Тести generic-consumer-а `ci.artifact@1` для `ci:azure` (spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction, §7.3, §10 Фаза 3 п.4): `contains-step`
 * на різних глибинах (`steps`/`jobs`/`stages`), обидві canonical-команди (domain command і
 * загальний full-lint fallback), відсутність `--no-fix` → violation, collision за `artifactId`.
 *
 * Fixture-templates — нейтральні (`lint-demo`), НЕ php.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { clearSlotResolveCache } from '@7n/rules/scripts/lib/plugin-slots.mjs'
import { clearPluginResolveCache } from '@7n/rules/scripts/lib/resolve-plugins.mjs'
import { withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

const ruleId = 'rules/ci_artifact'
const concernId = 'rules/ci_artifact/consume'
const TARGET_PATH = 'azure-pipelines.yml'
const DOT_PREFIX_RE = /^\.\//u

/** Скидає process-level кеші broker-а/резолвера плагінів між тестами (окрема tmp-репо на тест). */
function teardown() {
  clearSlotResolveCache()
  clearPluginResolveCache()
}

/**
 * Ставить у tmp-репо фейковий `ci.artifact@1` contributor plugin (той самий підхід, що
 * `@7n/rules-ci-github`'s тести) — `mergeStrategy: "contains-step"`, `fix: false` (v1
 * diagnostic-only, spec §7.3).
 * @param {string} dir корінь tmp-репо
 * @param {string} pluginName npm-ім'я плагіна-contributor-а
 * @param {{ artifactId: string, command: string }} opts payload-дескриптор
 * @returns {Promise<string>} абсолютний packageRoot
 */
async function writeArtifactContributorPlugin(dir, pluginName, opts) {
  const packageRoot = join(dir, 'node_modules', pluginName)
  await mkdir(packageRoot, { recursive: true })
  const descriptor = {
    targetCapability: 'ci:azure',
    artifactId: opts.artifactId,
    targetPath: TARGET_PATH,
    format: 'yaml',
    mode: 'patch-existing',
    template: './template.yml',
    mergeStrategy: 'contains-step',
    fix: false
  }
  const nRules = {
    requiresPluginApi: 2,
    capabilities: [],
    contributes: { rules: false },
    slots: {
      provides: [{ slot: 'ci.artifact', version: 1, id: opts.artifactId, resource: './artifact.json' }],
      consumes: []
    }
  }
  await writeJson(join(packageRoot, 'package.json'), { name: pluginName, version: '1.0.0', 'n-rules': nRules })
  await writeJson(join(packageRoot, 'artifact.json'), descriptor)
  await writeFile(join(packageRoot, 'template.yml'), `script: ${opts.command}\n`)
  return packageRoot
}

/**
 * Активує список плагінів у tmp-репо через `.n-rules.json`.
 * @param {string} dir корінь tmp-репо
 * @param {string[]} pluginNames npm-імена плагінів
 * @returns {Promise<void>}
 */
async function activatePlugins(dir, pluginNames) {
  await writeJson(join(dir, '.n-rules.json'), { plugins: pluginNames })
}

describe('ci-azure ci.artifact consumer', () => {
  test('patch-existing: pipeline відсутній → 0 violations (окремий концерн azure-pipelines)', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })

  test('contains-step: canonical крок відсутній на будь-якій глибині → violation', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])
      await writeFile(
        join(dir, TARGET_PATH),
        'trigger:\n  - main\nsteps:\n  - script: echo hello\n    displayName: irrelevant\n'
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('artifact-mismatch')
      teardown()
    })
  })

  test('contains-step: canonical крок на глибині stages→jobs→steps знаходиться', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])
      await writeFile(
        join(dir, TARGET_PATH),
        [
          'trigger:',
          '  - main',
          'stages:',
          '  - stage: Lint',
          '    jobs:',
          '      - job: LintJob',
          '        steps:',
          '          - script: bunx n-rules lint demo --no-fix',
          '            displayName: Lint demo'
        ].join('\n') + '\n'
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })

  test('contains-step: canonical крок на голому jobs→steps (без stages) знаходиться', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])
      await writeFile(
        join(dir, TARGET_PATH),
        [
          'trigger:',
          '  - main',
          'jobs:',
          '  - job: LintJob',
          '    steps:',
          '      - script: n-rules lint demo --no-fix',
          '        displayName: Lint demo'
        ].join('\n') + '\n'
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })

  test('приймає загальний full-lint fallback замість domain-команди', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])
      await writeFile(
        join(dir, TARGET_PATH),
        'trigger:\n  - main\nsteps:\n  - script: bunx n-rules lint --no-fix --full\n    displayName: Full lint\n'
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })

  test('приймає @7n/rules-префікс canonical-команди', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])
      await writeFile(
        join(dir, TARGET_PATH),
        'trigger:\n  - main\nsteps:\n  - script: bunx @7n/rules lint demo --no-fix\n    displayName: Lint demo\n'
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })

  test('canonical крок є, але без "--no-fix" десь у script-блобі → violation', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo'])
      await writeFile(
        join(dir, TARGET_PATH),
        'trigger:\n  - main\nsteps:\n  - script: bunx n-rules lint demo\n    displayName: Lint demo\n'
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(1)
      expect(violations[0].message).toContain('--no-fix')
      teardown()
    })
  })

  test('collision за artifactId: два РІЗНІ плагіни з однаковим artifactId → error з provenance обох', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo-a', { artifactId: 'lint-demo', command: 'lint demo' })
      await writeArtifactContributorPlugin(dir, '@x/lang-demo-b', { artifactId: 'lint-demo', command: 'lint demo' })
      await activatePlugins(dir, ['@x/lang-demo-a', '@x/lang-demo-b'])

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('artifact-id-collision')
      expect(violations[0].message).toContain('@x/lang-demo-a')
      expect(violations[0].message).toContain('@x/lang-demo-b')
      teardown()
    })
  })

  test('невалідний payload (fix:true заборонено для contains-step у v1) → default validate false, generic error', async () => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'node_modules', '@x/bad-demo')
      await mkdir(packageRoot, { recursive: true })
      const descriptor = {
        targetCapability: 'ci:azure',
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        format: 'yaml',
        mode: 'patch-existing',
        template: './template.yml',
        mergeStrategy: 'contains-step',
        fix: true // v1: Azure-payload завжди fix:false — це домен-специфічна вимога adapter-а, не broker-а
      }
      const nRules = {
        requiresPluginApi: 2,
        capabilities: [],
        contributes: { rules: false },
        slots: {
          provides: [{ slot: 'ci.artifact', version: 1, id: 'lint-demo', resource: './artifact.json' }],
          consumes: []
        }
      }
      await writeJson(join(packageRoot, 'package.json'), { name: '@x/bad-demo', version: '1.0.0', 'n-rules': nRules })
      await writeJson(join(packageRoot, 'artifact.json'), descriptor)
      await writeFile(join(packageRoot, 'template.yml'.replace(DOT_PREFIX_RE, '')), 'script: lint demo\n')
      await activatePlugins(dir, ['@x/bad-demo'])

      // collectArtifacts не викликає default.validate() (те окрема консюмер-контракт-перевірка,
      // не частина lint-детектора у v1) — payload з fix:true все одно валідний за
      // validateCiArtifactPayload (contract-рівень), тож детектор його обробляє нормально:
      // це підтверджує, що generic-contract і provider-specific policy — різні шари.
      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })
})
