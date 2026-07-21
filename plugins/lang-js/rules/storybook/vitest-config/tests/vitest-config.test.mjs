/**
 * Тести concern-а `storybook/vitest-config` (vitest-config.mdc, ADR Кластер 5):
 * виявлення відсутнього/неповного `test.projects` (unit+storybook) і відсутнього
 * ізольованого `vitest.stryker.config`, а також T0-autofix (`fix-vitest-config.mjs`),
 * що дописує storybook-project поверх наявного test-блоку, не руйнуючи його.
 * Фікстури — динамічні тимчасові дерева (mkdtemp), не статичні файли в репо (щоб
 * авто-fix лінтера цього репозиторію не переписав "погані"/неповні зразки).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  hasStoriesMarker,
  lint,
  PROVIDER_FACTORY_RE,
  REASON_STORYBOOK_PROJECT_MARKER_MISSING,
  REASON_STORYBOOK_PROJECT_MISSING,
  REASON_STRYKER_CONFIG_MISSING,
  REASON_UNIT_PROJECT_MISSING,
  REASON_VITEST_CONFIG_MISSING,
  resolveViteConfigName,
  resolveVitestConfigPath,
  storiesGlobForVitestConfig,
  strykerConfigPathFor
} from '../main.mjs'
import { patterns } from '../fix-vitest-config.mjs'

const CONCERN_DIR = join(import.meta.dirname, '..')
const NO_PROJECTS_KEY_RE = /\bprojects\s*:/u

const VITEST_CONFIG_BASIC = `import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    environment: 'happy-dom',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
}))
`

/**
 * @param {string} root абсолютний шлях
 * @param {string} rel відносний шлях файлу
 * @param {string} content вміст
 */
async function writeFileDeep(root, rel, content) {
  const abs = join(root, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Створює мінімальний Vue-пакет-бібліотеку у скоупі (peerDependencies.vue, ≥3 .vue,
 * vite.config.js) — той самий фікстур-набір, що й у scope/scaffold тестах.
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 * @param {string} [vitestConfigContent] опційний вміст vitest.config.mjs
 */
async function writeVueLibraryPkg(root, rootDir, vitestConfigContent) {
  const pkg = { name: `pkg-${rootDir}`, peerDependencies: { vue: '^3.6.0' } }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
  for (let i = 0; i < 3; i++) {
    await writeFileDeep(root, join(rootDir, `src/components/Comp${i}.vue`), '<template><div/></template>\n')
  }
  if (vitestConfigContent) {
    await writeFileDeep(root, join(rootDir, 'vitest.config.mjs'), vitestConfigContent)
  }
}

/**
 * Той самий фікстур-набір, але БЕЗ `vite.config.*` пакета — source-only Vue-бібліотека
 * (хвиля 1.4, реальний кейс tauri-components/npm): у скоупі Storybook (scope/main.mjs
 * більше не вимагає `hasStandardBuild`), але `resolveViteConfigName` не знаходить
 * жодного файлу.
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 */
async function writeSourceOnlyVueLibraryPkg(root, rootDir) {
  const pkg = { name: `pkg-${rootDir}`, peerDependencies: { vue: '^3.6.0' } }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  for (let i = 0; i < 3; i++) {
    await writeFileDeep(root, join(rootDir, `src/components/Comp${i}.vue`), '<template><div/></template>\n')
  }
}

/**
 * @param {string} root корінь монорепо (тимчасове дерево тесту)
 * @param {string[]} recordedWrites масив, куди накопичуються абсолютні шляхи `recordWrite`
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} fix-контекст рунга для тесту
 */
function makeFixCtx(root, recordedWrites) {
  return {
    cwd: root,
    ruleId: 'storybook',
    concernId: 'storybook/vitest-config',
    concernDir: CONCERN_DIR,
    tier: 'local-min',
    recordWrite: abs => {
      recordedWrites.push(abs)
    }
  }
}

describe('hasStoriesMarker / PROVIDER_FACTORY_RE', () => {
  test('явний stories-glob (include) — валідний маркер', () => {
    expect(hasStoriesMarker("include: ['src/components/**/*.stories.@(js|ts)']")).toBe(true)
  })

  test('storybookTest({ configDir }) без include — валідний маркер (glob неявний, зі Storybook-конфігурації)', () => {
    expect(hasStoriesMarker("plugins: [storybookTest({ configDir: '.storybook' })]")).toBe(true)
  })

  test('ані include, ані storybookTest({ configDir }) — не валідний маркер', () => {
    expect(hasStoriesMarker('plugins: [somePlugin()]')).toBe(false)
  })

  test('PROVIDER_FACTORY_RE: приймає factory-виклик, відкидає застарілу рядкову форму', () => {
    expect(PROVIDER_FACTORY_RE.test('provider: playwright()')).toBe(true)
    expect(PROVIDER_FACTORY_RE.test('provider: playwright({ launchOptions: {} })')).toBe(true)
    expect(PROVIDER_FACTORY_RE.test("provider: 'playwright'")).toBe(false)
  })
})

describe('storiesGlobForVitestConfig: type-aware (хвиля 2a)', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-vitest-config-glob-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('app-пакет з ОБОМА src/components/ і src/pages/ — широкий glob (не звужується до components)', async () => {
    await writeFileDeep(root, 'src/components/Shared.vue', '<template/>')
    await writeFileDeep(root, 'src/pages/task/[id].vue', '<template/>')
    // Без type — library-детекція звузила б до components (реальний баг, якого це виправляє).
    expect(storiesGlobForVitestConfig(root)).toBe('src/components/**/*.stories.@(js|ts)')
    expect(storiesGlobForVitestConfig(root, 'app')).toBe('src/**/*.stories.@(js|ts)')
  })

  test('library-пакет (type не заданий чи library) — стара layout-детекція без змін', async () => {
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    expect(storiesGlobForVitestConfig(root, 'library')).toBe('src/components/**/*.stories.@(js|ts)')
  })
})

describe('storybook/vitest-config: lint', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-vitest-config-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('немає пакетів у скоупі — без порушень', async () => {
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(result.violations).toEqual([])
  })

  test('пакет без vitest.config — лише vitest-config-missing', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(result.violations.map(v => v.reason)).toEqual([REASON_VITEST_CONFIG_MISSING])
    expect(result.violations[0].data.rootDir).toBe('packages/ui')
  })

  test('базовий vitest.config без projects — unit+storybook+stryker-config відсутні', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VITEST_CONFIG_BASIC)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    const reasons = result.violations.map(v => v.reason).toSorted()
    expect(reasons).toEqual(
      [REASON_STORYBOOK_PROJECT_MISSING, REASON_STRYKER_CONFIG_MISSING, REASON_UNIT_PROJECT_MISSING].toSorted()
    )
  })

  test('storybook-project присутній, але без канонічних маркерів — marker-порушення', async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [
      { extends: true, test: { name: 'unit' } },
      { extends: true, test: { name: 'storybook' } }
    ]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)
    await writeFileDeep(root, 'packages/ui/vitest.stryker.config.mjs', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].reason).toBe(REASON_STORYBOOK_PROJECT_MARKER_MISSING)
  })

  test('storybookTest({ configDir }) без явного include — валідний stories-маркер (пілот components/npm)', async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [
      { extends: true, test: { name: 'unit' } },
      {
        extends: true,
        plugins: [storybookTest({ configDir: join(dirName, '.storybook') })],
        test: {
          name: 'storybook',
          browser: { enabled: true, provider: playwright({}), instances: [{ browser: 'chromium' }] }
        }
      }
    ]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)
    await writeFileDeep(root, 'packages/ui/vitest.stryker.config.mjs', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(result.violations).toEqual([])
  })

  test("provider: 'playwright' (застаріле рядкове API) — marker-порушення навіть з chromium/browser/stories", async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [
      { extends: true, test: { name: 'unit' } },
      {
        extends: true,
        test: {
          name: 'storybook',
          include: ['src/components/**/*.stories.@(js|ts)'],
          browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }] }
        }
      }
    ]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)
    await writeFileDeep(root, 'packages/ui/vitest.stryker.config.mjs', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].reason).toBe(REASON_STORYBOOK_PROJECT_MARKER_MISSING)
    expect(result.violations[0].message).toContain('provider-factory')
  })

  test('лише unit-проєкт наявний — тільки storybook-project-missing (+ stryker)', async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [{ extends: true, test: { name: 'unit' } }]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    const reasons = result.violations.map(v => v.reason).toSorted()
    expect(reasons).toEqual([REASON_STORYBOOK_PROJECT_MISSING, REASON_STRYKER_CONFIG_MISSING].toSorted())
  })
})

describe('storybook/vitest-config: fix', () => {
  let root
  let recordedWrites

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-vitest-config-fix-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
    recordedWrites = []
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('vitest-config-missing: генерує повний vitest.config.mjs + vitest.stryker.config.mjs', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    const { violations } = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')
    expect(pattern.test(violations)).toBe(true)

    const result = await pattern.apply(violations, makeFixCtx(root, recordedWrites))
    expect(result.touchedFiles.length).toBeGreaterThan(0)

    const vitestConfigPath = resolveVitestConfigPath(join(root, 'packages/ui'))
    expect(vitestConfigPath).not.toBeNull()
    const written = await readFile(vitestConfigPath, 'utf8')
    expect(written).toContain("name: 'unit'")
    expect(written).toContain("name: 'storybook'")
    expect(written).toContain('chromium')
    expect(written).toContain(storiesGlobForVitestConfig(join(root, 'packages/ui')))

    const strykerPath = strykerConfigPathFor(vitestConfigPath)
    const strykerContent = await readFile(strykerPath, 'utf8')
    expect(strykerContent).toContain('happy-dom')
    expect(strykerContent).not.toContain('chromium')
    expect(strykerContent).not.toMatch(NO_PROJECTS_KEY_RE)

    const after = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(after.violations).toEqual([])
  })

  test('дописування storybook-project поверх наявного test-блоку — include/environment/coverage не чіпає', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VITEST_CONFIG_BASIC)
    const { violations } = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')

    const result = await pattern.apply(violations, makeFixCtx(root, recordedWrites))
    expect(result.touchedFiles.length).toBeGreaterThan(0)

    const vitestConfigPath = join(root, 'packages/ui/vitest.config.mjs')
    const written = await readFile(vitestConfigPath, 'utf8')
    // Наявний test-блок лишається незмінним.
    expect(written).toContain("include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}']")
    expect(written).toContain("environment: 'happy-dom'")
    expect(written).toContain("coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }")
    // Storybook-project дописано поверх.
    expect(written).toContain("name: 'unit'")
    expect(written).toContain("name: 'storybook'")
    expect(written).toContain('chromium')
    expect(written).toContain('browser')
    expect(written).toContain("import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'")

    const after = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(after.violations).toEqual([])
  })

  test('лише unit наявний — дописує тільки storybook-запис, не дублює unit', async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [{ extends: true, test: { name: 'unit' } }]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)
    const { violations } = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')
    await pattern.apply(violations, makeFixCtx(root, recordedWrites))

    const written = await readFile(join(root, 'packages/ui/vitest.config.mjs'), 'utf8')
    const unitOccurrences = written.match(/name: 'unit'/gu) ?? []
    expect(unitOccurrences).toHaveLength(1)
    expect(written).toContain("name: 'storybook'")

    const after = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(after.violations).toEqual([])
  })

  test('ідемпотентність: повторний fix на вже канонічному пакеті нічого не пише', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VITEST_CONFIG_BASIC)
    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')

    const first = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    await pattern.apply(first.violations, makeFixCtx(root, recordedWrites))

    const second = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(second.violations).toEqual([])

    recordedWrites.length = 0
    const result = await pattern.apply(second.violations, makeFixCtx(root, recordedWrites))
    expect(result.touchedFiles).toEqual([])
    expect(recordedWrites).toEqual([])
  })

  test('marker-missing (storybook-project без chromium) — без автофіксу, лишається порушенням', async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [
      { extends: true, test: { name: 'unit' } },
      { extends: true, test: { name: 'storybook' } }
    ]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)
    await writeFileDeep(root, 'packages/ui/vitest.stryker.config.mjs', 'export default {}\n')

    const before = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(before.violations.map(v => v.reason)).toEqual([REASON_STORYBOOK_PROJECT_MARKER_MISSING])

    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')
    expect(pattern.test(before.violations)).toBe(false)

    const after = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(after.violations.map(v => v.reason)).toEqual([REASON_STORYBOOK_PROJECT_MARKER_MISSING])
  })

  test('stryker-config-missing: генерується поруч, коли vitest.config уже канонічний', async () => {
    const content = VITEST_CONFIG_BASIC.replace(
      "coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }",
      `coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
    projects: [
      { extends: true, test: { name: 'unit' } },
      {
        extends: true,
        test: {
          name: 'storybook',
          include: ['src/components/**/*.stories.@(js|ts)'],
          browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] }
        }
      }
    ]`
    )
    await writeVueLibraryPkg(root, 'packages/ui', content)

    const before = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(before.violations.map(v => v.reason)).toEqual([REASON_STRYKER_CONFIG_MISSING])

    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')
    const result = await pattern.apply(before.violations, makeFixCtx(root, recordedWrites))
    expect(result.touchedFiles).toHaveLength(1)

    const strykerContent = await readFile(join(root, 'packages/ui/vitest.stryker.config.mjs'), 'utf8')
    expect(strykerContent).toContain('happy-dom')
    expect(strykerContent).not.toMatch(NO_PROJECTS_KEY_RE)

    const after = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(after.violations).toEqual([])
  })

  test('source-only пакет без жодного vite.config.* (хвиля 1.4, tauri-components/npm): fix не генерує import неіснуючого файлу', async () => {
    await writeSourceOnlyVueLibraryPkg(root, 'packages/ui')
    expect(resolveViteConfigName(join(root, 'packages/ui'))).toBeNull()

    const { violations } = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    const pattern = patterns.find(p => p.id === 'storybook-vitest-config-fix')
    const result = await pattern.apply(violations, makeFixCtx(root, recordedWrites))
    expect(result.touchedFiles.length).toBeGreaterThan(0)

    const vitestConfigPath = resolveVitestConfigPath(join(root, 'packages/ui'))
    const written = await readFile(vitestConfigPath, 'utf8')
    expect(written).toContain('const viteConfig = {}')
    expect(written).not.toContain("from './vite.config.js'")
    expect(written).toContain("name: 'storybook'")

    const strykerPath = strykerConfigPathFor(vitestConfigPath)
    const strykerContent = await readFile(strykerPath, 'utf8')
    expect(strykerContent).toContain('const viteConfig = {}')
    expect(strykerContent).not.toContain("from './vite.config.js'")

    // `after`-лінт нижче парсить обидва згенеровані файли (oxc-parser) — якщо fallback
    // зламав синтаксис mergeConfig-обгортки, тут з'явилось би REASON_CONFIG_UNRESOLVABLE.
    const after = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/vitest-config' })
    expect(after.violations).toEqual([])
  })
})
