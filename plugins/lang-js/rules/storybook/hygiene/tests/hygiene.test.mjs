/**
 * Тести гігієни залежностей канону Storybook (storybook.mdc, ADR Кластер 6): undeclared
 * third-party imports у `.vue`-файлах і auto-detect глобальних Quasar SCSS-змінних.
 * Фікстури — динамічні тимчасові дерева (mkdtemp), не статичні файли в репо: статичний
 * "поганий" package.json/vite.config у дереві правила проходив би через lint-обхід
 * (eslint/oxfmt/doc-files) цього ж репозиторію.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { lint } from '../main.mjs'
import { VUE_FILE_THRESHOLD } from '../../scope/main.mjs'

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
 * Створює мінімальний Vue-пакет-бібліотеку (peerDependencies.vue) з N `.vue`-файлами й
 * vite.config.js — задовольняє скоуп канону Storybook.
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 * @param {object} [pkgOverrides] додаткові поля package.json (dependencies тощо)
 * @param {Record<string, string>} [vueFiles] відносний шлях (від пакета) → вміст `.vue`-файлу
 */
async function writeVueLibraryPkg(root, rootDir, pkgOverrides = {}, vueFiles = {}) {
  const pkg = {
    name: `pkg-${rootDir}`,
    peerDependencies: { vue: '^3.6.0' },
    ...pkgOverrides
  }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')

  const entries = Object.entries(vueFiles)
  const padded = [...entries]
  // Поріг скоупу — не менше VUE_FILE_THRESHOLD .vue-файлів; добиваємо нейтральними компонентами.
  for (let i = padded.length; i < VUE_FILE_THRESHOLD; i++) {
    padded.push([`src/components/Filler${i}.vue`, '<template><div/></template>\n'])
  }
  for (const [rel, content] of padded) {
    await writeFileDeep(root, join(rootDir, rel), content)
  }
}

/**
 * Мінімальний app-пакет у скоупі хвилі 2a (`vue` у dependencies, `src/pages/`,
 * `.n-rules.json` → `storybook.detectApps: true`) — для регрес-тестів на false-positive
 * hygiene-перевірок (undeclared-import на Vite resolve.alias, sass-variables на app-main.js
 * без `sassVariables`-маркера за каноном).
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 * @param {Record<string, string>} [vueFiles] відносний шлях (від пакета) → вміст `.vue`-файлу
 */
async function writeVueAppPkg(root, rootDir, vueFiles = {}) {
  const pkg = { name: `app-${rootDir}`, dependencies: { vue: '^3.6.0' } }
  await writeFileDeep(root, join(rootDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
  await writeFileDeep(root, '.n-rules.json', JSON.stringify({ rules: [], storybook: { detectApps: true } }, null, 2))
  for (const [rel, content] of Object.entries(vueFiles)) {
    await writeFileDeep(root, join(rootDir, rel), content)
  }
}

describe('storybook/hygiene lint', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-hygiene-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('немає Vue component library пакетів у скоупі — без порушень', async () => {
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations).toEqual([])
  })

  test('undeclared import: сторонній пакет не в dependencies/peerDependencies — порушення', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      {},
      {
        'src/components/DatePicker.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import VueDatePicker from '@vuepic/vue-datepicker'",
          '</script>'
        ].join('\n')
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    const found = result.violations.filter(v => v.reason === 'undeclared-import')
    expect(found).toHaveLength(1)
    expect(found[0].file).toBe('packages/ui/src/components/DatePicker.vue')
    expect(found[0].data.package).toBe('@vuepic/vue-datepicker')
  })

  test('declared import: пакет задекларований у dependencies — без порушень', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      { dependencies: { '@vuepic/vue-datepicker': '^11.0.0' } },
      {
        'src/components/DatePicker.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import VueDatePicker from '@vuepic/vue-datepicker'",
          '</script>'
        ].join('\n')
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'undeclared-import')).toEqual([])
  })

  test('subpath-імпорт: pkg/sub звіряється за іменем пакета верхнього рівня', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      { dependencies: { lodash: '^4.17.21' } },
      {
        'src/components/Debounced.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import debounce from 'lodash/debounce'",
          '</script>'
        ].join('\n')
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'undeclared-import')).toEqual([])
  })

  test('scoped subpath-імпорт без декларації — порушення на @scope/name, не на підшлях', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      {},
      {
        'src/components/Icon.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import { QIcon } from '@quasar/extras/material-icons'",
          '</script>'
        ].join('\n')
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    const found = result.violations.filter(v => v.reason === 'undeclared-import')
    expect(found).toHaveLength(1)
    expect(found[0].data.package).toBe('@quasar/extras')
  })

  test('workspace-пакет (@nitra/*) задекларований у dependencies — без порушень', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      { dependencies: { '@nitra/tfm': '^1.0.0' } },
      {
        'src/components/Greeting.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import { tf } from '@nitra/tfm'",
          'function getTr() { return {} }',
          '</script>'
        ].join('\n')
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'undeclared-import')).toEqual([])
  })

  test('відносний імпорт і Vite-аліас @/ — пропускаються, не звіряються з deps', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      {},
      {
        'src/components/Wrapper.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import Local from './Local.vue'",
          "import Shared from '@/composables/shared.js'",
          '</script>'
        ].join('\n'),
        'src/components/Local.vue': '<template><div/></template>\n',
        'src/composables/shared.js': 'export const shared = {}\n'
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'undeclared-import')).toEqual([])
  })

  test('Node-builtin імпорт у .vue — пропускається (поза обсягом hygiene, не її предмет)', async () => {
    await writeVueLibraryPkg(
      root,
      'packages/ui',
      {},
      {
        'src/components/Weird.vue': [
          '<template><div/></template>',
          '<script setup>',
          "import { join } from 'node:path'",
          '</script>'
        ].join('\n')
      }
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'undeclared-import')).toEqual([])
  })

  test('sassVariables: quasar.variables.scss присутній, .storybook/main.js без sassVariables — warn', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, 'packages/ui/src/css/quasar.variables.scss', '$primary: #1976d2;\n')
    await writeFileDeep(
      root,
      'packages/ui/.storybook/main.js',
      "import { quasar } from '@quasar/vite-plugin'\nconst config = { }\nexport default config\n"
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    const found = result.violations.filter(v => v.reason === 'missing-sass-variables')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].file).toBe('packages/ui/.storybook/main.js')
  })

  test('sassVariables: заданий у .storybook/main.js — без порушень', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, 'packages/ui/src/css/quasar.variables.scss', '$primary: #1976d2;\n')
    await writeFileDeep(root, 'packages/ui/.storybook/main.js', 'quasar({ sassVariables: true })\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'missing-sass-variables')).toEqual([])
  })

  test('sassVariables: немає глобальних SCSS-змінних — без порушень навіть без sassVariables', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, 'packages/ui/.storybook/main.js', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'missing-sass-variables')).toEqual([])
  })

  test('sassVariables: немає .storybook/main.js — без порушень (покриває storybook/scaffold)', async () => {
    await writeVueLibraryPkg(root, 'packages/ui')
    await writeFileDeep(root, 'packages/ui/src/css/quasar.variables.scss', '$primary: #1976d2;\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'missing-sass-variables')).toEqual([])
  })

  test('app-пакет (хвиля 2a): Vite resolve.alias-специфікатор ("components/Foo.vue") у .vue — БЕЗ undeclared-import (регрес пілота gt)', async () => {
    await writeVueAppPkg(root, 'packages/gt', {
      'src/pages/task/[id].vue': [
        '<template><div/></template>',
        '<script setup>',
        // Легітимний імпорт через Vite `resolve.alias` (`components` → `src/components`,
        // типова Quasar CLI-конвенція) — не сторонній npm-пакет.
        "import Shared from 'components/Shared.vue'",
        '</script>'
      ].join('\n'),
      'src/components/Shared.vue': '<template><div/></template>\n'
    })
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'undeclared-import')).toEqual([])
  })

  test('app-пакет (хвиля 2a): справжній сторонній undeclared import у .vue — теж НЕ перевіряється (hygiene лише для library)', async () => {
    await writeVueAppPkg(root, 'packages/gt', {
      'src/pages/task/[id].vue': [
        '<template><div/></template>',
        '<script setup>',
        "import VueDatePicker from '@vuepic/vue-datepicker'",
        '</script>'
      ].join('\n')
    })
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations).toEqual([])
  })

  test('app-пакет (хвиля 2a): quasar.variables.scss присутній, канонічний app-main.js без sassVariables — БЕЗ warn (регрес пілота gt)', async () => {
    await writeVueAppPkg(root, 'packages/gt', { 'src/pages/task/[id].vue': '<template><div/></template>\n' })
    await writeFileDeep(root, 'packages/gt/src/css/quasar.variables.scss', '$primary: #1976d2;\n')
    // Канонічний app-main.js (scaffold/template/app-main.js) СВІДОМО не викликає quasar() —
    // builder-vite підхоплює повний vite.config.js app-проєкту без власного viteFinal-інстанса.
    await writeFileDeep(
      root,
      'packages/gt/.storybook/main.js',
      "const config = { framework: '@storybook/vue3-vite', viteFinal: c => c }\nexport default config\n"
    )
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/hygiene' })
    expect(result.violations.filter(v => v.reason === 'missing-sass-variables')).toEqual([])
  })
})
