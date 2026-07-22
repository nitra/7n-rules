/**
 * Тести детекції скоупу канону Storybook (storybook.mdc): поріг `.vue`-файлів, opt-out
 * через `.n-rules.json`, app-проєкти хвилі 2 (за прапорцем). Наявність `vite.config.*` —
 * НЕ умова скоупу (хвиля 1.4, фікс за rollout-ом на tauri-components/npm) — окремі тести
 * нижче звіряють, що пакет без жодного `vite.config.*` усе одно потрапляє у скоуп.
 * Фікстури — динамічні тимчасові дерева (mkdtemp), не статичні файли в репо: статичний
 * "поганий" package.json/vite.config у дереві правила проходив би через lint-обхід
 * (eslint/oxfmt/doc-files) цього ж репозиторію.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  collectInScopeVuePackages,
  countVueFiles,
  isVueAppPkg,
  lint,
  readDetectAppsFlag,
  readStorybookOptOut,
  VUE_FILE_THRESHOLD
} from '../main.mjs'

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
 * Створює мінімальний Vue-пакет-бібліотеку (peerDependencies.vue) з N `.vue`-файлами
 * і vite.config.js — задовольняє скоуп за замовчуванням (стандартний build).
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 * @param {number} vueFileCount кількість `.vue`-файлів
 * @param {object} [pkgOverrides] додаткові поля package.json
 */
async function writeVueLibraryPkg(root, rootDir, vueFileCount, pkgOverrides = {}) {
  const pkg = {
    name: `pkg-${rootDir}`,
    peerDependencies: { vue: '^3.6.0' },
    ...pkgOverrides
  }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
  for (let i = 0; i < vueFileCount; i++) {
    await writeFileDeep(root, join(rootDir, `src/components/Comp${i}.vue`), '<template><div/></template>\n')
  }
}

describe('countVueFiles', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scope-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('countVueFiles рахує лише .vue у дереві пакета', async () => {
    await writeFileDeep(root, 'src/components/A.vue', '<template/>')
    await writeFileDeep(root, 'src/components/B.vue', '<template/>')
    await writeFileDeep(root, 'src/utils.js', 'export const x = 1\n')
    expect(await countVueFiles(root, [])).toBe(2)
  })
})

describe('isVueAppPkg', () => {
  test('true: vue у dependencies, не бібліотека', () => {
    expect(isVueAppPkg({ dependencies: { vue: '^3.6.0' } })).toBe(true)
  })

  test('false: vue і в dependencies, і в peerDependencies (бібліотека)', () => {
    expect(isVueAppPkg({ dependencies: { vue: '^3.6.0' }, peerDependencies: { vue: '^3.6.0' } })).toBe(false)
  })

  test('false: без vue у dependencies', () => {
    expect(isVueAppPkg({})).toBe(false)
  })
})

describe('collectInScopeVuePackages', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scope-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('пакет із vue у peerDependencies і ≥3 .vue-файлами — у скоупі', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VUE_FILE_THRESHOLD)
    const result = await collectInScopeVuePackages(root)
    expect(result.map(r => r.rootDir)).toEqual(['packages/ui'])
    expect(result[0].vueFileCount).toBe(VUE_FILE_THRESHOLD)
  })

  test('поріг: менше VUE_FILE_THRESHOLD .vue-файлів — поза скоупом', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VUE_FILE_THRESHOLD - 1)
    const result = await collectInScopeVuePackages(root)
    expect(result).toEqual([])
  })

  test('vue лише в dependencies (не peerDependencies) — не бібліотека, поза скоупом хвилі 1', async () => {
    await writeFileDeep(
      root,
      'packages/app/package.json',
      JSON.stringify({ name: 'app', dependencies: { vue: '^3.6.0' } }, null, 2)
    )
    await writeFileDeep(root, 'packages/app/vite.config.js', 'export default {}\n')
    for (let i = 0; i < VUE_FILE_THRESHOLD; i++) {
      await writeFileDeep(root, `packages/app/src/Comp${i}.vue`, '<template/>')
    }
    const result = await collectInScopeVuePackages(root)
    expect(result).toEqual([])
  })

  test('пакет без жодного vite.config.* (source-only бібліотека) — у скоупі (хвиля 1.4, tauri-components/npm)', async () => {
    await writeFileDeep(
      root,
      'packages/ui/package.json',
      JSON.stringify({ name: 'ui', peerDependencies: { vue: '^3.6.0' } }, null, 2)
    )
    for (let i = 0; i < VUE_FILE_THRESHOLD; i++) {
      await writeFileDeep(root, `packages/ui/src/components/Comp${i}.vue`, '<template/>')
    }
    const result = await collectInScopeVuePackages(root)
    expect(result.map(r => r.rootDir)).toEqual(['packages/ui'])
    expect(result[0].vueFileCount).toBe(VUE_FILE_THRESHOLD)
  })

  test('opt-out через .n-rules.json storybook.optOut виключає пакет зі скоупу', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VUE_FILE_THRESHOLD)
    await writeFileDeep(
      root,
      '.n-rules.json',
      JSON.stringify({ rules: [], storybook: { optOut: ['packages/ui'] } }, null, 2)
    )
    expect(await readStorybookOptOut(root)).toEqual(['packages/ui'])
    const result = await collectInScopeVuePackages(root)
    expect(result).toEqual([])
  })

  test('readStorybookOptOut: порожній масив, коли .n-rules.json відсутній', async () => {
    expect(await readStorybookOptOut(root)).toEqual([])
  })

  test('app-проєкт (vue у dependencies + src/pages) поза скоупом без прапорця detectApps', async () => {
    await writeFileDeep(
      root,
      'packages/demo/package.json',
      JSON.stringify({ name: 'demo', dependencies: { vue: '^3.6.0' } }, null, 2)
    )
    await writeFileDeep(root, 'packages/demo/vite.config.js', 'export default {}\n')
    await writeFileDeep(root, 'packages/demo/src/pages/Home.vue', '<template/>')
    for (let i = 0; i < VUE_FILE_THRESHOLD; i++) {
      await writeFileDeep(root, `packages/demo/src/pages/Page${i}.vue`, '<template/>')
    }
    expect(await readDetectAppsFlag(root)).toBe(false)
    const result = await collectInScopeVuePackages(root)
    expect(result).toEqual([])
  })

  test('app-проєкт потрапляє у скоуп лише за явного storybook.detectApps=true', async () => {
    await writeFileDeep(
      root,
      'packages/demo/package.json',
      JSON.stringify({ name: 'demo', dependencies: { vue: '^3.6.0' } }, null, 2)
    )
    await writeFileDeep(root, 'packages/demo/vite.config.js', 'export default {}\n')
    for (let i = 0; i < VUE_FILE_THRESHOLD; i++) {
      await writeFileDeep(root, `packages/demo/src/pages/Page${i}.vue`, '<template/>')
    }
    await writeFileDeep(root, '.n-rules.json', JSON.stringify({ rules: [], storybook: { detectApps: true } }, null, 2))
    expect(await readDetectAppsFlag(root)).toBe(true)
    const result = await collectInScopeVuePackages(root)
    expect(result.map(r => r.rootDir)).toEqual(['packages/demo'])
  })
})

describe('lint (self-check конфігурації)', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scope-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('без storybook.optOut — без порушень', async () => {
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scope' })
    expect(result.violations).toEqual([])
  })

  test('storybook.optOut на неіснуючий пакет — порушення stale-opt-out', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VUE_FILE_THRESHOLD)
    await writeFileDeep(
      root,
      '.n-rules.json',
      JSON.stringify({ rules: [], storybook: { optOut: ['packages/ghost'] } }, null, 2)
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scope' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].reason).toBe('stale-opt-out')
  })

  test('storybook.optOut на існуючий пакет — без порушень', async () => {
    await writeVueLibraryPkg(root, 'packages/ui', VUE_FILE_THRESHOLD)
    await writeFileDeep(
      root,
      '.n-rules.json',
      JSON.stringify({ rules: [], storybook: { optOut: ['packages/ui'] } }, null, 2)
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/scope' })
    expect(result.violations).toEqual([])
  })
})
