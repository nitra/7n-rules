/**
 * Тести generic-consumer-а `ci.artifact@1` для `ci:github` (spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction, §7.2, §10 Фаза 3 п.4): required-file
 * create (T0), deep-subset validate/fix idempotent, set-union scalar-масивів, step identity за
 * id/uses/name, patch-existing лише коли target вже існує, детермінований порядок двох
 * contributors в один target file, collision за `artifactId`.
 *
 * Fixture-templates — нейтральні (`lint-demo`), НЕ php: generic-adapter не знає про мовні домени.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { patterns } from '../fix-consume.mjs'
import { clearSlotResolveCache } from '@7n/rules/scripts/lib/plugin-slots.mjs'
import { clearPluginResolveCache } from '@7n/rules/scripts/lib/resolve-plugins.mjs'
import { withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

const ruleId = 'rules/ci_artifact'
const concernId = 'rules/ci_artifact/consume'
const fixPattern = patterns.find(p => p.id === 'ci-github-ci-artifact-consume')
const DOT_PREFIX_RE = /^\.\//u

/** Скидає process-level кеші broker-а/резолвера плагінів між тестами (окрема tmp-репо на тест). */
function teardown() {
  clearSlotResolveCache()
  clearPluginResolveCache()
}

/** Канонічний, НЕЙТРАЛЬНИЙ (не-php) demo-workflow — required-file mode. */
const DEMO_WORKFLOW_SNIPPET = `name: Lint Demo
on:
  push:
    paths:
      - '**/*.demo'
jobs:
  demo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Lint demo
        run: bunx n-rules lint demo --no-fix
`

/**
 * Ставить у tmp-репо фейковий `ci.artifact@1` contributor plugin — той самий підхід, що
 * `plugin-slots.test.mjs`'s `writeFakeSlotPlugin`, спеціалізований під один descriptor +
 * template resource.
 * @param {string} dir корінь tmp-репо
 * @param {string} pluginName npm-ім'я плагіна-contributor-а
 * @param {{ artifactId: string, targetPath: string, mode: string, mergeStrategy?: string, fix?: boolean, templateRelPath?: string, templateContent?: string }} opts payload-дескриптор
 * @returns {Promise<string>} абсолютний packageRoot
 */
async function writeArtifactContributorPlugin(dir, pluginName, opts) {
  const packageRoot = join(dir, 'node_modules', pluginName)
  await mkdir(packageRoot, { recursive: true })
  const templateRelPath = opts.templateRelPath ?? './template.yml'
  const descriptor = {
    targetCapability: 'ci:github',
    artifactId: opts.artifactId,
    targetPath: opts.targetPath,
    format: 'yaml',
    mode: opts.mode,
    template: templateRelPath,
    mergeStrategy: opts.mergeStrategy ?? 'deep-subset',
    fix: opts.fix ?? true
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
  await mkdir(join(packageRoot, templateRelPath, '..'), { recursive: true })
  await writeFile(
    join(packageRoot, templateRelPath.replace(DOT_PREFIX_RE, '')),
    opts.templateContent ?? DEMO_WORKFLOW_SNIPPET
  )
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

const TARGET_PATH = '.github/workflows/lint-demo.yml'

describe('ci-github ci.artifact consumer', () => {
  test('required-file: файл відсутній → 1 violation, T0 створює canonical файл', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await activatePlugins(dir, ['@x/lang-demo'])

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('artifact-missing')
      expect(violations[0].file).toBe(TARGET_PATH)

      const result = await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      expect(result.touchedFiles).toHaveLength(1)
      expect(existsSync(join(dir, TARGET_PATH))).toBe(true)
      const content = await readFile(join(dir, TARGET_PATH), 'utf8')
      expect(content).toBe(DEMO_WORKFLOW_SNIPPET)

      const after = await lint({ cwd: dir, ruleId, concernId })
      expect(after.violations).toHaveLength(0)
      teardown()
    })
  })

  test('deep-subset: відсутній canonical крок → violation, T0 idempotent-фікс', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await activatePlugins(dir, ['@x/lang-demo'])

      // Наявний workflow — без canonical lint-кроку (уже checkout, consumer-specific job-назва лишається).
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(
        join(dir, TARGET_PATH),
        `name: Lint Demo\non:\n  push:\n    paths:\n      - '**/*.demo'\njobs:\n  demo:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n`
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0].reason).toBe('artifact-mismatch')

      const fixResult = await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      expect(fixResult.touchedFiles).toHaveLength(1)

      const afterFix = await lint({ cwd: dir, ruleId, concernId })
      expect(afterFix.violations).toHaveLength(0)

      // Ідемпотентність: повторний apply на вже-канонічному файлі — без запису.
      const idempotentResult = await fixPattern.apply([], { cwd: dir, ruleId, concernId })
      expect(idempotentResult.touchedFiles).toEqual([])
      teardown()
    })
  })

  test('set-union scalar-масивів: consumer-specific шлях у on.push.paths не видаляється', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await activatePlugins(dir, ['@x/lang-demo'])

      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(
        join(dir, TARGET_PATH),
        `name: Lint Demo\non:\n  push:\n    paths:\n      - 'consumer-specific/**'\njobs:\n  demo:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - name: Lint demo\n        run: bunx n-rules lint demo --no-fix\n`
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations.some(v => v.message.includes('**/*.demo'))).toBe(true)

      await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      const content = await readFile(join(dir, TARGET_PATH), 'utf8')
      expect(content).toContain('consumer-specific/**')
      expect(content).toContain('**/*.demo')
      teardown()
    })
  })

  test('step identity за id/uses/name: зайві поля кроку не викликають дублювання', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await activatePlugins(dir, ['@x/lang-demo'])

      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      // Крок "Lint demo" вже існує (той самий `name`), але з зайвим consumer-specific полем
      // `continue-on-error` і БЕЗ канонічного `run` — очікуємо merge У цей самий крок, не
      // додавання нового.
      await writeFile(
        join(dir, TARGET_PATH),
        `name: Lint Demo\non:\n  push:\n    paths:\n      - '**/*.demo'\njobs:\n  demo:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - name: Lint demo\n        continue-on-error: true\n`
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations.length).toBeGreaterThan(0)

      await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      const content = await readFile(join(dir, TARGET_PATH), 'utf8')
      const stepCount = content.split('- name: Lint demo').length - 1
      expect(stepCount).toBe(1) // не задубльовано
      expect(content).toContain('continue-on-error: true') // consumer-specific поле збережено
      expect(content).toContain('bunx n-rules lint demo --no-fix') // canonical run — merge застосовано

      const after = await lint({ cwd: dir, ruleId, concernId })
      expect(after.violations).toHaveLength(0)
      teardown()
    })
  })

  test('patch-existing: target відсутній → 0 violations (файл належить іншому концерну)', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', {
        artifactId: 'demo-text-patch',
        targetPath: '.github/workflows/lint-text.yml',
        mode: 'patch-existing',
        templateContent: "on:\n  push:\n    paths:\n      - '**/*.demo'\n"
      })
      await activatePlugins(dir, ['@x/lang-demo'])

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(0)
      teardown()
    })
  })

  test('patch-existing: target існує без канонічного патчу → violation, фіксується', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo', {
        artifactId: 'demo-text-patch',
        targetPath: '.github/workflows/lint-text.yml',
        mode: 'patch-existing',
        templateContent: "on:\n  push:\n    paths:\n      - '**/*.demo'\n"
      })
      await activatePlugins(dir, ['@x/lang-demo'])
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(
        join(dir, '.github/workflows/lint-text.yml'),
        "name: Lint Text\non:\n  push:\n    paths:\n      - '**/*.md'\njobs:\n  text:\n    runs-on: ubuntu-latest\n    steps: []\n"
      )

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('artifact-mismatch')

      await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      const content = await readFile(join(dir, '.github/workflows/lint-text.yml'), 'utf8')
      expect(content).toContain('**/*.md') // існуючий glob не видалено
      expect(content).toContain('**/*.demo') // canonical glob — merge застосовано

      const after = await lint({ cwd: dir, ruleId, concernId })
      expect(after.violations).toHaveLength(0)
      teardown()
    })
  })

  test('два contributors в один target file: детермінований порядок застосування', async () => {
    await withTmpDir(async dir => {
      // А (required-file) — база; Б (patch-existing) — консюмер-specific доповнення, від ІНШОГО плагіна.
      await writeArtifactContributorPlugin(dir, '@x/lang-demo-a', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await writeArtifactContributorPlugin(dir, '@x/lang-demo-b', {
        artifactId: 'lint-demo-extra-path',
        targetPath: TARGET_PATH,
        mode: 'patch-existing',
        templateContent: "on:\n  push:\n    paths:\n      - 'extra/**'\n"
      })
      await activatePlugins(dir, ['@x/lang-demo-a', '@x/lang-demo-b'])

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      // А: файл відсутній → artifact-missing; Б: patch-existing на відсутній файл → мовчазний no-op.
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('artifact-missing')

      await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      // Після Т0 А файл існує → повторний detect+fix підхопить Б.
      const secondRun = await lint({ cwd: dir, ruleId, concernId })
      await fixPattern.apply(secondRun.violations, { cwd: dir, ruleId, concernId })

      const content = await readFile(join(dir, TARGET_PATH), 'utf8')
      expect(content).toContain('**/*.demo') // А
      expect(content).toContain('extra/**') // Б

      const final = await lint({ cwd: dir, ruleId, concernId })
      expect(final.violations).toHaveLength(0)
      teardown()
    })
  })

  test('collision за artifactId: два РІЗНІ плагіни з однаковим artifactId → error з provenance обох', async () => {
    await withTmpDir(async dir => {
      await writeArtifactContributorPlugin(dir, '@x/lang-demo-a', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await writeArtifactContributorPlugin(dir, '@x/lang-demo-b', {
        artifactId: 'lint-demo',
        targetPath: TARGET_PATH,
        mode: 'required-file'
      })
      await activatePlugins(dir, ['@x/lang-demo-a', '@x/lang-demo-b'])

      const { violations } = await lint({ cwd: dir, ruleId, concernId })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('artifact-id-collision')
      expect(violations[0].message).toContain('@x/lang-demo-a')
      expect(violations[0].message).toContain('@x/lang-demo-b')

      // T0 не чіпає жоден файл, поки колізія не вирішена вручну.
      const result = await fixPattern.apply(violations, { cwd: dir, ruleId, concernId })
      expect(result.touchedFiles).toEqual([])
      expect(existsSync(join(dir, TARGET_PATH))).toBe(false)
      teardown()
    })
  })
})
