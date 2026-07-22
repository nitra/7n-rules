/**
 * Тести канонічного скафолду `.storybook/` (storybook.mdc): виявлення відсутніх файлів,
 * маркерів канону й `scripts.storybook`, а також T0-autofix (`fix-scaffold.mjs`), що
 * відтворює скафолд із `template/`. Фікстури — динамічні тимчасові дерева (mkdtemp),
 * не статичні файли в репо (авто-fix лінтера цього репозиторію переписав би "погані"
 * зразки, якби вони лежали як звичайні файли під деревом правила).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { APP_STORIES_GLOB, detectStoriesGlob, lint, STORYBOOK_SCRIPT } from '../main.mjs'
import { patterns } from '../fix-scaffold.mjs'

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
 * vite.config.js) — без `.storybook/`, щоб перевірити порушення "відсутній скафолд".
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 * @param {object} [pkgOverrides] додаткові поля package.json
 */
async function writeVueLibraryPkg(root, rootDir, pkgOverrides = {}) {
  const pkg = { name: `pkg-${rootDir}`, peerDependencies: { vue: '^3.6.0' }, ...pkgOverrides }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
  for (let i = 0; i < 3; i++) {
    await writeFileDeep(root, join(rootDir, `src/components/Comp${i}.vue`), '<template><div/></template>\n')
  }
}

/**
 * Створює мінімальний app-пакет у скоупі хвилі 2a (`vue` у dependencies, `src/pages/`,
 * `.n-rules.json` → `storybook.detectApps: true`) — без `.storybook/`.
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 * @param {object} [pkgOverrides] додаткові поля package.json
 */
async function writeVueAppPkg(root, rootDir, pkgOverrides = {}) {
  const pkg = { name: `app-${rootDir}`, dependencies: { vue: '^3.6.0' }, ...pkgOverrides }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
  await writeFileDeep(root, join(rootDir, 'src/pages/task/[id].vue'), '<template><div/></template>\n')
  await writeFileDeep(root, '.n-rules.json', JSON.stringify({ rules: [], storybook: { detectApps: true } }, null, 2))
}

describe('detectStoriesGlob', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scaffold-glob-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('src/components/ присутній — звужений glob', async () => {
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../src/components/**/*.stories.@(js|ts)')
  })

  test('пласка структура (src/ без components/) — ширший glob', async () => {
    await writeFileDeep(root, 'src/Comp.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../src/**/*.stories.@(js|ts)')
  })

  test('flat-root: .vue-файли прямо в корені пакета (без src/) — flat-root glob', async () => {
    await writeFileDeep(root, 'NDialog.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../*.stories.@(js|ts)')
  })

  test('flat-root має пріоритет над src/components/, якщо корінь теж містить .vue', async () => {
    await writeFileDeep(root, 'NDialog.vue', '<template/>')
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../*.stories.@(js|ts)')
  })

  test('немає жодного .vue у корені — flat-root не спрацьовує (fallback на src/components)', async () => {
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    await writeFileDeep(root, 'README.md', '# not vue')
    expect(detectStoriesGlob(root)).toBe('../src/components/**/*.stories.@(js|ts)')
  })
})

describe('lint: перевірка канонічного скафолду', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scaffold-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('немає пакетів у скоупі — без порушень', async () => {
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations).toEqual([])
  })

  test('пакет у скоупі без .storybook/ — 5 порушень (main.js, preview.js, empty-vite.config.js, vitest.setup.js, script)', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    const reasons = result.violations.map(v => v.reason).toSorted()
    expect(reasons).toEqual([
      'missing-empty-vite-config',
      'missing-main-js',
      'missing-preview-js',
      'missing-storybook-script',
      'missing-vitest-setup-js'
    ])
    expect(
      result.violations.every(v => v.data?.rootDir === 'packages/ui' || v.file === 'packages/ui/package.json')
    ).toBe(true)
  })

  test('main.js без канонічних маркерів — marker-порушення, не missing', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: STORYBOOK_SCRIPT } })
    await writeFileDeep(root, 'packages/ui/.storybook/main.js', 'export default {}\n')
    await writeFileDeep(root, 'packages/ui/.storybook/preview.js', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    const reasons = result.violations.map(v => v.reason).toSorted()
    expect(reasons).toContain('main-js-marker-missing')
    expect(reasons).toContain('preview-js-marker-missing')
    expect(reasons).not.toContain('missing-main-js')
    expect(reasons).not.toContain('missing-preview-js')
  })

  test('повністю канонічний пакет — без порушень', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/main.js'), 'utf8')
    const previewTemplate = await readFile(join(CONCERN_DIR, 'template/preview.js'), 'utf8')
    const emptyViteConfigTemplate = await readFile(join(CONCERN_DIR, 'template/empty-vite.config.js'), 'utf8')
    const vitestSetupTemplate = await readFile(join(CONCERN_DIR, 'template/vitest.setup.js'), 'utf8')
    await writeFileDeep(
      root,
      'packages/ui/.storybook/main.js',
      mainTemplate.split('__STORYBOOK_STORIES_GLOB__').join('../src/components/**/*.stories.@(js|ts)')
    )
    await writeFileDeep(root, 'packages/ui/.storybook/preview.js', previewTemplate)
    await writeFileDeep(root, 'packages/ui/.storybook/empty-vite.config.js', emptyViteConfigTemplate)
    await writeFileDeep(root, 'packages/ui/.storybook/vitest.setup.js', vitestSetupTemplate)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations).toEqual([])
  })

  test('script неканонічний — лише missing-storybook-script', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: 'storybook dev' } })
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/main.js'), 'utf8')
    const previewTemplate = await readFile(join(CONCERN_DIR, 'template/preview.js'), 'utf8')
    const emptyViteConfigTemplate = await readFile(join(CONCERN_DIR, 'template/empty-vite.config.js'), 'utf8')
    const vitestSetupTemplate = await readFile(join(CONCERN_DIR, 'template/vitest.setup.js'), 'utf8')
    await writeFileDeep(
      root,
      'packages/ui/.storybook/main.js',
      mainTemplate.split('__STORYBOOK_STORIES_GLOB__').join('../src/components/**/*.stories.@(js|ts)')
    )
    await writeFileDeep(root, 'packages/ui/.storybook/preview.js', previewTemplate)
    await writeFileDeep(root, 'packages/ui/.storybook/empty-vite.config.js', emptyViteConfigTemplate)
    await writeFileDeep(root, 'packages/ui/.storybook/vitest.setup.js', vitestSetupTemplate)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations.map(v => v.reason)).toEqual(['missing-storybook-script'])
  })

  test('vitest.setup.js без канонічних маркерів — marker-порушення, не missing', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/main.js'), 'utf8')
    const previewTemplate = await readFile(join(CONCERN_DIR, 'template/preview.js'), 'utf8')
    const emptyViteConfigTemplate = await readFile(join(CONCERN_DIR, 'template/empty-vite.config.js'), 'utf8')
    await writeFileDeep(
      root,
      'packages/ui/.storybook/main.js',
      mainTemplate.split('__STORYBOOK_STORIES_GLOB__').join('../src/components/**/*.stories.@(js|ts)')
    )
    await writeFileDeep(root, 'packages/ui/.storybook/preview.js', previewTemplate)
    await writeFileDeep(root, 'packages/ui/.storybook/empty-vite.config.js', emptyViteConfigTemplate)
    await writeFileDeep(root, 'packages/ui/.storybook/vitest.setup.js', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations.map(v => v.reason)).toEqual([
      'vitest-setup-js-marker-missing',
      'vitest-setup-js-marker-missing'
    ])
  })
})

describe('lint: app-скафолд хвилі 2a (дзеркальна асиметрія з бібліотекою)', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scaffold-app-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('app-пакет без .storybook/ — 4 порушення (app-main.js, app-preview.js, vitest.setup.js, script), БЕЗ empty-vite-config', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    const reasons = result.violations.map(v => v.reason).toSorted()
    expect(reasons).toEqual([
      'missing-app-main-js',
      'missing-app-preview-js',
      'missing-storybook-script',
      'missing-vitest-setup-js'
    ])
  })

  test('app-пакет з канонічним app-main.js/app-preview.js/vitest.setup.js — без порушень', async () => {
    await writeVueAppPkg(root, 'packages/gt', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/app-main.js'), 'utf8')
    const previewTemplate = await readFile(join(CONCERN_DIR, 'template/app-preview.js'), 'utf8')
    const vitestSetupTemplate = await readFile(join(CONCERN_DIR, 'template/vitest.setup.js'), 'utf8')
    await writeFileDeep(
      root,
      'packages/gt/.storybook/main.js',
      mainTemplate.split('__STORYBOOK_STORIES_GLOB__').join(APP_STORIES_GLOB)
    )
    await writeFileDeep(root, 'packages/gt/.storybook/preview.js', previewTemplate)
    await writeFileDeep(root, 'packages/gt/.storybook/vitest.setup.js', vitestSetupTemplate)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations).toEqual([])
  })

  test('app-main.js без viteConfigPath-обходу — це НЕ порушення (свідома асиметрія з бібліотекою)', async () => {
    await writeVueAppPkg(root, 'packages/gt', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/app-main.js'), 'utf8')
    const previewTemplate = await readFile(join(CONCERN_DIR, 'template/app-preview.js'), 'utf8')
    // Функціональний маркер обходу — core.builder.options, не сам підрядок "viteConfigPath"
    // (він згадується в коментарі шаблону як пояснення, ЧОМУ обходу немає).
    expect(mainTemplate).not.toContain('core: {')
    await writeFileDeep(
      root,
      'packages/gt/.storybook/main.js',
      mainTemplate.split('__STORYBOOK_STORIES_GLOB__').join(APP_STORIES_GLOB)
    )
    await writeFileDeep(root, 'packages/gt/.storybook/preview.js', previewTemplate)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations.some(v => v.reason.includes('empty-vite-config'))).toBe(false)
  })

  test('app-main.js НЕ знімає vite-plugin-pages (регрес фіксу пілота gt — знімати його ламає storybook build)', async () => {
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/app-main.js'), 'utf8')
    expect(mainTemplate).not.toContain("'vite-plugin-pages'")
    // Справжні layout/router-генератори лишаються під фільтром.
    expect(mainTemplate).toContain("'unplugin-vue-router'")
    expect(mainTemplate).toContain("'vite-plugin-vue-layouts'")
    expect(mainTemplate).toContain("'vite-plugin-vue-layouts-next'")
  })

  test('app-main.js без vite-plugin-pages у ROUTING_PLUGIN_PREFIXES — НЕ порушення marker-перевірки', async () => {
    await writeVueAppPkg(root, 'packages/gt', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/app-main.js'), 'utf8')
    const previewTemplate = await readFile(join(CONCERN_DIR, 'template/app-preview.js'), 'utf8')
    const vitestSetupTemplate = await readFile(join(CONCERN_DIR, 'template/vitest.setup.js'), 'utf8')
    await writeFileDeep(
      root,
      'packages/gt/.storybook/main.js',
      mainTemplate.split('__STORYBOOK_STORIES_GLOB__').join(APP_STORIES_GLOB)
    )
    await writeFileDeep(root, 'packages/gt/.storybook/preview.js', previewTemplate)
    await writeFileDeep(root, 'packages/gt/.storybook/vitest.setup.js', vitestSetupTemplate)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations).toEqual([])
  })
})

/**
 * Fix-контекст рунга для T0-патернів (спільний для бібліотечних і app fix-тестів —
 * `sonarjs/no-identical-functions` не дозволяє тримати дублікат тіла в кожному describe).
 * @param {string} root корінь тимчасового дерева
 * @param {string[]} recordedWrites масив, куди накопичуються `recordWrite`-виклики
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} fix-контекст
 */
function makeFixCtx(root, recordedWrites) {
  return {
    cwd: root,
    ruleId: 'storybook',
    concernId: 'storybook/scaffold',
    concernDir: CONCERN_DIR,
    tier: 'local-min',
    recordWrite: abs => {
      recordedWrites.push(abs)
    }
  }
}

describe('fix-scaffold: T0 autofix відтворює канонічні файли', () => {
  let root
  let recordedWrites

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-fix-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
    recordedWrites = []
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} fix-контекст рунга для тесту */
  function fixCtx() {
    return makeFixCtx(root, recordedWrites)
  }

  test('storybook-scaffold-main-js: створює .storybook/main.js зі stories-glob за layout', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-main-js')
    const violations = [
      {
        reason: 'missing-main-js',
        message: 'x',
        file: 'packages/ui/.storybook/main.js',
        data: { rootDir: 'packages/ui' }
      }
    ]
    expect(pattern.test(violations)).toBe(true)
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles.length).toBeGreaterThan(0)
    const written = await readFile(join(root, 'packages/ui/.storybook/main.js'), 'utf8')
    expect(written).toContain('../src/components/**/*.stories.@(js|ts)')
    expect(written).toContain('@storybook/vue3-vite')
    expect(written).toContain('viteConfigPath')
    const mocks = await readFile(join(root, 'packages/ui/.storybook/mocks/gql-sse.js'), 'utf8')
    expect(mocks).toContain('sseSubscription')
    // empty-vite.config.js — генерується разом з main.js (belt-and-suspenders): main.js
    // без нього неробочий (посилається через viteConfigPath).
    const emptyViteConfig = await readFile(join(root, 'packages/ui/.storybook/empty-vite.config.js'), 'utf8')
    expect(emptyViteConfig).toContain('defineConfig({})')
    // recordWrite — обов'язок T0-патерну перед кожним записом (rollback-контракт runner-а).
    expect(recordedWrites.length).toBe(result.touchedFiles.length)
  })

  test('storybook-scaffold-empty-vite-config: створює лише сам файл, якщо main.js вже канонічний', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-empty-vite-config')
    const violations = [
      {
        reason: 'missing-empty-vite-config',
        message: 'x',
        file: 'packages/ui/.storybook/empty-vite.config.js',
        data: { rootDir: 'packages/ui' }
      }
    ]
    expect(pattern.test(violations)).toBe(true)
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const written = await readFile(join(root, 'packages/ui/.storybook/empty-vite.config.js'), 'utf8')
    expect(written).toContain('defineConfig({})')
  })

  test('storybook-scaffold-vitest-setup-js: створює .storybook/vitest.setup.js verbatim з шаблону (той самий для library/app)', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-vitest-setup-js')
    const violations = [
      {
        reason: 'missing-vitest-setup-js',
        message: 'x',
        file: 'packages/ui/.storybook/vitest.setup.js',
        data: { rootDir: 'packages/ui' }
      }
    ]
    expect(pattern.test(violations)).toBe(true)
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const written = await readFile(join(root, 'packages/ui/.storybook/vitest.setup.js'), 'utf8')
    expect(written).toContain('setProjectAnnotations')
    expect(written).toContain('beforeAll')
  })

  test('storybook-scaffold-preview-js: створює .storybook/preview.js verbatim з шаблону', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-preview-js')
    const violations = [
      {
        reason: 'missing-preview-js',
        message: 'x',
        file: 'packages/ui/.storybook/preview.js',
        data: { rootDir: 'packages/ui' }
      }
    ]
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const written = await readFile(join(root, 'packages/ui/.storybook/preview.js'), 'utf8')
    expect(written).toContain('iconMapFn')
    expect(written).toContain('msw-storybook-addon')
  })

  test('storybook-scaffold-package-script: встановлює канонічний scripts.storybook', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-package-script')
    const violations = [
      {
        reason: 'missing-storybook-script',
        message: 'x',
        file: 'packages/ui/package.json',
        data: { rootDir: 'packages/ui' }
      }
    ]
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const pkg = JSON.parse(await readFile(join(root, 'packages/ui/package.json'), 'utf8'))
    expect(pkg.scripts.storybook).toBe(STORYBOOK_SCRIPT)
  })

  test('storybook-scaffold-package-script: idempotent — не чіпає вже канонічний скрипт', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-package-script')
    const violations = [
      {
        reason: 'missing-storybook-script',
        message: 'x',
        file: 'packages/ui/package.json',
        data: { rootDir: 'packages/ui' }
      }
    ]
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toEqual([])
  })

  test('після autofix повний lint-цикл повертає 0 порушень', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const mainPattern = patterns.find(p => p.id === 'storybook-scaffold-main-js')
    const previewPattern = patterns.find(p => p.id === 'storybook-scaffold-preview-js')
    const vitestSetupPattern = patterns.find(p => p.id === 'storybook-scaffold-vitest-setup-js')
    const scriptPattern = patterns.find(p => p.id === 'storybook-scaffold-package-script')

    await mainPattern.apply(
      [
        {
          reason: 'missing-main-js',
          message: 'x',
          file: 'packages/ui/.storybook/main.js',
          data: { rootDir: 'packages/ui' }
        }
      ],
      fixCtx()
    )
    await previewPattern.apply(
      [
        {
          reason: 'missing-preview-js',
          message: 'x',
          file: 'packages/ui/.storybook/preview.js',
          data: { rootDir: 'packages/ui' }
        }
      ],
      fixCtx()
    )
    await vitestSetupPattern.apply(
      [
        {
          reason: 'missing-vitest-setup-js',
          message: 'x',
          file: 'packages/ui/.storybook/vitest.setup.js',
          data: { rootDir: 'packages/ui' }
        }
      ],
      fixCtx()
    )
    await scriptPattern.apply(
      [
        {
          reason: 'missing-storybook-script',
          message: 'x',
          file: 'packages/ui/package.json',
          data: { rootDir: 'packages/ui' }
        }
      ],
      fixCtx()
    )

    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations).toEqual([])
  })
})

describe('fix-scaffold: T0 autofix для app-пакетів (хвиля 2a)', () => {
  let root
  let recordedWrites

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-fix-app-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
    recordedWrites = []
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} fix-контекст рунга для тесту */
  function fixCtx() {
    return makeFixCtx(root, recordedWrites)
  }

  test('storybook-scaffold-app-main-js: створює app-канонічний .storybook/main.js без viteConfigPath', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-app-main-js')
    const violations = [
      {
        reason: 'missing-app-main-js',
        message: 'x',
        file: 'packages/gt/.storybook/main.js',
        data: { rootDir: 'packages/gt' }
      }
    ]
    expect(pattern.test(violations)).toBe(true)
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles.length).toBeGreaterThan(0)
    const written = await readFile(join(root, 'packages/gt/.storybook/main.js'), 'utf8')
    expect(written).toContain(APP_STORIES_GLOB)
    expect(written).toContain('@storybook/vue3-vite')
    // Функціональний маркер обходу — core.builder.options, не сам підрядок "viteConfigPath"
    // (він згадується в коментарі шаблону як пояснення, ЧОМУ обходу немає).
    expect(written).not.toContain('core: {')
    // Регрес фіксу пілота gt: vite-plugin-pages НЕ знімається (знімати його ламає
    // storybook build глобально через <route lang="yaml">-блоки без обробника).
    expect(written).not.toContain("'vite-plugin-pages'")
    const mocks = await readFile(join(root, 'packages/gt/.storybook/mocks/gql-sse.js'), 'utf8')
    expect(mocks).toContain('sseSubscription')
    expect(recordedWrites.length).toBe(result.touchedFiles.length)
  })

  test('storybook-scaffold-app-preview-js: створює app-канонічний .storybook/preview.js з pageLoader', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    const pattern = patterns.find(p => p.id === 'storybook-scaffold-app-preview-js')
    const violations = [
      {
        reason: 'missing-app-preview-js',
        message: 'x',
        file: 'packages/gt/.storybook/preview.js',
        data: { rootDir: 'packages/gt' }
      }
    ]
    const result = await pattern.apply(violations, fixCtx())
    expect(result.touchedFiles).toHaveLength(1)
    const written = await readFile(join(root, 'packages/gt/.storybook/preview.js'), 'utf8')
    expect(written).toContain('pageLoader')
    expect(written).toContain('QLayout')
    expect(written).toContain('msw-storybook-addon')
  })

  test('після autofix app-пакета повний lint-цикл повертає 0 порушень', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    const mainPattern = patterns.find(p => p.id === 'storybook-scaffold-app-main-js')
    const previewPattern = patterns.find(p => p.id === 'storybook-scaffold-app-preview-js')
    const vitestSetupPattern = patterns.find(p => p.id === 'storybook-scaffold-vitest-setup-js')
    const scriptPattern = patterns.find(p => p.id === 'storybook-scaffold-package-script')

    await mainPattern.apply(
      [
        {
          reason: 'missing-app-main-js',
          message: 'x',
          file: 'packages/gt/.storybook/main.js',
          data: { rootDir: 'packages/gt' }
        }
      ],
      fixCtx()
    )
    await previewPattern.apply(
      [
        {
          reason: 'missing-app-preview-js',
          message: 'x',
          file: 'packages/gt/.storybook/preview.js',
          data: { rootDir: 'packages/gt' }
        }
      ],
      fixCtx()
    )
    await vitestSetupPattern.apply(
      [
        {
          reason: 'missing-vitest-setup-js',
          message: 'x',
          file: 'packages/gt/.storybook/vitest.setup.js',
          data: { rootDir: 'packages/gt' }
        }
      ],
      fixCtx()
    )
    await scriptPattern.apply(
      [
        {
          reason: 'missing-storybook-script',
          message: 'x',
          file: 'packages/gt/package.json',
          data: { rootDir: 'packages/gt' }
        }
      ],
      fixCtx()
    )

    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scaffold' })
    expect(result.violations).toEqual([])
  })
})
