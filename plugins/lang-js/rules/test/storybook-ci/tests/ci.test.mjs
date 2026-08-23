/**
 * Тести T0-autofix-у concern-а `storybook/ci` (storybook.mdc, ADR Кластер 5 — CI-частина):
 * `fix-storybook-ci.mjs` відтворює канонічний composite action `setup-playwright-chromium`
 * і `.github/workflows/lint-storybook.yml` з `template/`. Сам детектор (`main.mjs`) видалено —
 * покриття перенесено в `crates/plugin-lang-js` `#[cfg(test)]` (`detect_storybook_ci_*`),
 * wasm-порт лишається єдиним каноном lint-поверхні; T0-фікс і надалі — зафіксована прогалина
 * host-мосту, JS-канон (§2.3 `docs/plans/2026-08-05-open-questions-register.md`). Фікстури —
 * динамічні тимчасові дерева (mkdtemp), не статичні файли в репо (щоб авто-fix лінтера цього
 * репозиторію не переписав "погані"/неповні зразки).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { patterns, renderPackageDirsYaml, renderStorybookWorkflow } from '../fix-storybook-ci.mjs'

const CONCERN_DIR = join(import.meta.dirname, '..')

/** Repo-relative шлях канонічного composite action (дзеркало видаленого `main.mjs`-експорту). */
const PLAYWRIGHT_ACTION_REL = '.github/actions/setup-playwright-chromium/action.yml'

/** Repo-relative шлях канонічного workflow (дзеркало видаленого `main.mjs`-експорту). */
const STORYBOOK_WORKFLOW_REL = '.github/workflows/lint-storybook.yml'

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
