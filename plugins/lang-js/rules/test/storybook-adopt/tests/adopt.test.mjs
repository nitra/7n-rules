/**
 * Тести adopt-режиму (`adopt/main.mjs`, ADR Кластер 8): діагностика diff по секціях
 * проти канонічних template без сліпого перезапису розбіжних файлів, автофікс лише
 * для повністю відсутніх секцій, і circuit breaker — збій одного пакета не валить
 * увесь прогін. Фікстури — динамічні тимчасові дерева (mkdtemp), як у сусідніх
 * scaffold/vitest-config тестах.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { collectInScopeVuePackages } from '../../storybook-scope/main.mjs'
import { STORYBOOK_SCRIPT } from '../../storybook-scaffold/main.mjs'
import {
  renderEmptyViteConfig,
  renderMainJs,
  renderMocksGqlSse,
  renderPreviewJs
} from '../../storybook-scaffold/fix-storybook-scaffold.mjs'
import { buildStrykerConfig } from '../../storybook-vitest-config/fix-storybook-vitest-config.mjs'
import { diagnosePackage, formatReport, runAdopt, SECTION, STATUS } from '../main.mjs'

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
 * vite.config.js) — без `.storybook/`.
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
 * Заповнює `packages/ui/.storybook/` і `vitest.config.mjs`/`vitest.stryker.config.mjs`
 * повністю канонічним вмістом (верифіковано через `lint` в сусідніх тестах concern-ів).
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 */
async function writeCanonicalStorybookSetup(root, rootDir) {
  const absPkgDir = join(root, rootDir)
  await writeFileDeep(root, join(rootDir, '.storybook/main.js'), renderMainJs(absPkgDir))
  await writeFileDeep(root, join(rootDir, '.storybook/preview.js'), renderPreviewJs())
  await writeFileDeep(root, join(rootDir, '.storybook/empty-vite.config.js'), renderEmptyViteConfig())
  await writeFileDeep(root, join(rootDir, '.storybook/mocks/gql-sse.js'), renderMocksGqlSse())
  await writeFileDeep(
    root,
    join(rootDir, 'vitest.config.mjs'),
    [
      "import { defineConfig, mergeConfig } from 'vitest/config'",
      "import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'",
      "import viteConfig from './vite.config.js'",
      '',
      'export default mergeConfig(',
      '  viteConfig,',
      '  defineConfig({',
      '    test: {',
      '      projects: [',
      "        { extends: true, test: { name: 'unit' } },",
      '        {',
      '          extends: true,',
      "          plugins: [storybookTest({ configDir: '.storybook' })],",
      '          test: {',
      "            name: 'storybook',",
      "            include: ['src/components/**/*.stories.@(js|ts)'],",
      "            browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] }",
      '          }',
      '        }',
      '      ]',
      '    }',
      '  })',
      ')'
    ].join('\n')
  )
}

describe('diagnosePackage — канонічний пакет', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-adopt-canon-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('усі секції — match, статус canonical', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: STORYBOOK_SCRIPT } })
    await writeCanonicalStorybookSetup(root, 'packages/ui')
    // stryker-конфіг генерується разом із vitest-конфігом — байтовий канон із fix-vitest-config.mjs.
    const strykerConfig = await buildStrykerConfig(join(root, 'packages/ui'))
    await writeFileDeep(root, 'packages/ui/vitest.stryker.config.mjs', strykerConfig)

    const pkgs = await collectInScopeVuePackages(root)
    const [entry] = pkgs
    const diagnosis = await diagnosePackage(entry)

    expect(diagnosis.status).toBe('canonical')
    expect(diagnosis.sections.every(s => s.status === STATUS.MATCH)).toBe(true)
  })
})

describe('adopt — розбіжний main.js: diff-звіт без перезапису', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-adopt-differ-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('ручний main.js без канонічних маркерів — status differs, файл НЕ перезаписано', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', { scripts: { storybook: STORYBOOK_SCRIPT } })
    const manualMainJs = "// ручний Storybook-конфіг, ще не мігрований на канон\nexport default { framework: 'x' }\n"
    await writeFileDeep(root, 'packages/ui/.storybook/main.js', manualMainJs)
    await writeFileDeep(root, 'packages/ui/.storybook/preview.js', renderPreviewJs())

    const results = await runAdopt(root, { fixMissing: true })
    const uiResult = results.find(r => r.rootDir === 'packages/ui')

    expect(uiResult.status).toBe('differs')
    const mainSection = uiResult.sections.find(s => s.name === SECTION.MAIN_JS)
    expect(mainSection.status).toBe(STATUS.DIFFER)
    expect(mainSection.detail).toContain('бракує')

    // --fix-missing НЕ чіпає differ-секції — ручний файл лишається без змін.
    const stillManual = await readFile(join(root, 'packages/ui/.storybook/main.js'), 'utf8')
    expect(stillManual).toBe(manualMainJs)

    const report = formatReport(results)
    expect(report).toContain('differs')
    expect(report).toContain(SECTION.MAIN_JS)
  })
})

describe('adopt — відсутній файл: --fix-missing генерує з template', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-adopt-missing-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('немає .storybook/ взагалі — missing-files, fixMissing генерує канонічні файли', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')

    const diagnoseOnly = await runAdopt(root, { fixMissing: false })
    const before = diagnoseOnly.find(r => r.rootDir === 'packages/ui')
    expect(before.status).toBe('missing-files')
    expect(before.sections.every(s => s.status === STATUS.MISSING)).toBe(true)
    expect(before.written).toEqual([])

    const fixed = await runAdopt(root, { fixMissing: true })
    const after = fixed.find(r => r.rootDir === 'packages/ui')
    expect(after.written.length).toBeGreaterThan(0)

    const mainJs = await readFile(join(root, 'packages/ui/.storybook/main.js'), 'utf8')
    expect(mainJs).toContain('@storybook/vue3-vite')
    expect(mainJs).toContain('viteConfigPath')
    const previewJs = await readFile(join(root, 'packages/ui/.storybook/preview.js'), 'utf8')
    expect(previewJs).toContain('iconMapFn')
    const emptyViteConfig = await readFile(join(root, 'packages/ui/.storybook/empty-vite.config.js'), 'utf8')
    expect(emptyViteConfig).toContain('defineConfig({})')
    const mocks = await readFile(join(root, 'packages/ui/.storybook/mocks/gql-sse.js'), 'utf8')
    expect(mocks).toContain('sseSubscription')
    const pkg = JSON.parse(await readFile(join(root, 'packages/ui/package.json'), 'utf8'))
    expect(pkg.scripts.storybook).toBe(STORYBOOK_SCRIPT)
    const vitestConfig = await readFile(join(root, 'packages/ui/vitest.config.mjs'), 'utf8')
    expect(vitestConfig).toContain("name: 'storybook'")
    const strykerConfig = await readFile(join(root, 'packages/ui/vitest.stryker.config.mjs'), 'utf8')
    expect(strykerConfig).not.toContain('storybookTest')
    expect(strykerConfig).not.toContain('chromium')

    // Повторна діагностика після фіксу — усе канонічне (крім того, чого fixMissing
    // свідомо не чіпає — тут нема, все було missing).
    const secondPass = await runAdopt(root, { fixMissing: false })
    const final = secondPass.find(r => r.rootDir === 'packages/ui')
    expect(final.status).toBe('canonical')
  })
})

describe('adopt — circuit breaker: зламаний пакет деградує до warning', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-adopt-broken-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('один зламаний пакет — status broken лише для нього, решта прогону не падає', async () => {
    // packages/broken: .storybook/mocks/gql-sse.js — ДИРЕКТОРІЯ замість файлу (типова
    // real-world поломка ручного мержу) → readFileSync кидає EISDIR під час діагностики.
    await writeVueLibraryPkg(root, 'packages/broken', { scripts: { storybook: STORYBOOK_SCRIPT } })
    await writeFileDeep(root, 'packages/broken/.storybook/main.js', renderMainJs(join(root, 'packages/broken')))
    await mkdir(join(root, 'packages/broken/.storybook/mocks/gql-sse.js'), { recursive: true })

    // packages/ok: звичайний пакет без .storybook/ — має обробитись нормально.
    await writeVueLibraryPkg(root, 'packages/ok')

    const results = await runAdopt(root, { fixMissing: false })

    const broken = results.find(r => r.rootDir === 'packages/broken')
    expect(broken.status).toBe('broken')
    expect(typeof broken.error).toBe('string')

    const ok = results.find(r => r.rootDir === 'packages/ok')
    expect(ok.status).toBe('missing-files')

    const report = formatReport(results)
    expect(report).toContain('circuit breaker')
  })
})
