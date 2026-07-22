/**
 * Тести concern-а `storybook/ci` (storybook.mdc, ADR Кластер 5 — CI-частина): виявлення
 * відсутнього/неповного composite action `setup-playwright-chromium` і відсутнього/неповного
 * `.github/workflows/lint-storybook.yml`, а також T0-autofix (`fix-ci.mjs`), що відтворює
 * обидва файли з `template/`. Фікстури — динамічні тимчасові дерева (mkdtemp), не статичні
 * файли в репо (щоб авто-fix лінтера цього репозиторію не переписав "погані"/неповні зразки).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { lint, PLAYWRIGHT_ACTION_REL, STORYBOOK_WORKFLOW_REL } from '../main.mjs'
import { patterns, renderPackageDirsYaml, renderPlaywrightAction, renderStorybookWorkflow } from '../fix-storybook-ci.mjs'

const CONCERN_DIR = join(import.meta.dirname, '..')

/**
 * @param {string} root абсолютний шлях
 * @param {string} rel відносний шлях файлу
 * @param {string} content вміст
 */
async function writeFileDeep(root, rel, content) {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Створює мінімальний Vue-пакет-бібліотеку у скоупі (peerDependencies.vue, ≥3 .vue,
 * vite.config.js) — той самий фікстур-набір, що й у scaffold/vitest-config/hygiene тестах.
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 */
async function writeVueLibraryPkg(root, rootDir) {
  const pkg = { name: `pkg-${rootDir}`, peerDependencies: { vue: '^3.6.0' } }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
  for (let i = 0; i < 3; i++) {
    await writeFileDeep(root, join(rootDir, `src/components/Comp${i}.vue`), '<template><div/></template>\n')
  }
}

describe('lint: перевірка storybook/ci', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-ci-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('немає пакетів у скоупі — без порушень', async () => {
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/ci' })
    expect(result.violations).toEqual([])
  })

  test('пакет у скоупі, без composite action і без workflow — 2 порушення missing', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/ci' })
    const reasons = result.violations.map(v => v.reason).toSorted()
    expect(reasons).toEqual(['missing-playwright-action', 'missing-storybook-workflow'])
    expect(result.violations.find(v => v.reason === 'missing-playwright-action').file).toBe(PLAYWRIGHT_ACTION_REL)
    expect(result.violations.find(v => v.reason === 'missing-storybook-workflow').file).toBe(STORYBOOK_WORKFLOW_REL)
  })

  test('composite action без канонічних маркерів — marker-порушення, не missing', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, PLAYWRIGHT_ACTION_REL, 'name: Setup Playwright Chromium\nruns:\n  using: composite\n')
    const rootDirs = ['packages/ui']
    await writeFileDeep(
      root,
      STORYBOOK_WORKFLOW_REL,
      await renderStorybookWorkflow(rootDirs, join(CONCERN_DIR, 'template'))
    )

    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/ci' })
    const reasons = result.violations.map(v => v.reason)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.every(r => r === 'playwright-action-marker-missing')).toBe(true)
  })

  test('workflow без канонічних маркерів — marker-порушення, не missing', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, PLAYWRIGHT_ACTION_REL, await renderPlaywrightAction(join(CONCERN_DIR, 'template')))
    await writeFileDeep(
      root,
      STORYBOOK_WORKFLOW_REL,
      'name: Lint Storybook\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
    )

    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/ci' })
    const reasons = result.violations.map(v => v.reason)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.every(r => r === 'storybook-workflow-marker-missing')).toBe(true)
  })

  test('повністю канонічний репо — без порушень', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, PLAYWRIGHT_ACTION_REL, await renderPlaywrightAction(join(CONCERN_DIR, 'template')))
    await writeFileDeep(
      root,
      STORYBOOK_WORKFLOW_REL,
      await renderStorybookWorkflow(['packages/ui'], join(CONCERN_DIR, 'template'))
    )

    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/ci' })
    expect(result.violations).toEqual([])
  })
})

describe('renderPackageDirsYaml', () => {
  test('рендерить по одному елементу на рядок з відступом рівня matrix.package', () => {
    expect(renderPackageDirsYaml(['.', 'packages/ui'])).toBe('          - .\n          - packages/ui')
  })
})

describe('renderStorybookWorkflow', () => {
  test('підставляє матрицю пакетів у валідний YAML з канонічними маркерами', async () => {
    const content = await renderStorybookWorkflow(['packages/ui', 'packages/forms'], join(CONCERN_DIR, 'template'))
    expect(content).toContain('- packages/ui')
    expect(content).toContain('- packages/forms')
    expect(content).toContain('./.github/actions/setup-playwright-chromium')
    expect(content).toContain('--project=storybook')
    expect(content).not.toContain('__STORYBOOK_CI_PACKAGE_DIRS__')
  })
})

describe('fix-ci: T0 autofix відтворює канонічні файли', () => {
  let root
  let recordedWrites

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-ci-fix-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
    recordedWrites = []
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} fix-контекст рунга для тесту */
  function fixCtx() {
    return {
      cwd: root,
      ruleId: 'storybook',
      concernId: 'storybook/ci',
      concernDir: CONCERN_DIR,
      tier: 'local-min',
      recordWrite: abs => {
        recordedWrites.push(abs)
      }
    }
  }

  test('storybook-ci-playwright-action: створює composite action verbatim з шаблону', async () => {
    const pattern = patterns.find(p => p.id === 'storybook-ci-playwright-action')
    const violations = [{ reason: 'missing-playwright-action', message: 'x', file: PLAYWRIGHT_ACTION_REL }]
    expect(pattern.test(violations)).toBe(true)

    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const written = await readFile(join(root, PLAYWRIGHT_ACTION_REL), 'utf8')
    expect(written).toContain('ms-playwright')
    expect(written).toContain('playwright install chromium')
    expect(recordedWrites).toEqual(result.touchedFiles)
  })

  test('storybook-ci-workflow: створює lint-storybook.yml з матрицею фактичних пакетів у скоупі', async () => {
    await writeFileDeep(root, 'packages/ui/package.json', JSON.stringify({ peerDependencies: { vue: '^3.6.0' } }))
    await writeFileDeep(root, 'packages/ui/vite.config.js', 'export default {}\n')
    for (let i = 0; i < 3; i++) {
      await writeFileDeep(root, `packages/ui/src/components/Comp${i}.vue`, '<template><div/></template>\n')
    }

    const pattern = patterns.find(p => p.id === 'storybook-ci-workflow')
    const violations = [{ reason: 'missing-storybook-workflow', message: 'x', file: STORYBOOK_WORKFLOW_REL }]
    expect(pattern.test(violations)).toBe(true)

    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const written = await readFile(join(root, STORYBOOK_WORKFLOW_REL), 'utf8')
    expect(written).toContain('- packages/ui')
    expect(written).toContain('--project=storybook')
    expect(recordedWrites).toEqual(result.touchedFiles)
  })

  test('storybook-ci-workflow: без пакетів у скоупі — нічого не пише', async () => {
    const pattern = patterns.find(p => p.id === 'storybook-ci-workflow')
    const violations = [{ reason: 'missing-storybook-workflow', message: 'x', file: STORYBOOK_WORKFLOW_REL }]
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toEqual([])
  })
})
