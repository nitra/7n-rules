/**
 * Тести резолву плагінів: детект за файлами/repository.url, пріоритет config.plugins,
 * graceful skip невстановлених, читання маніфесту (capabilities/handlers), кеш.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  clearPluginResolveCache,
  detectPluginsFromRepo,
  ensurePluginInstalled,
  getActiveCapabilities,
  getHandlers,
  resolvePluginList,
  resolvePlugins,
  resolveRulesDirs
} from '../resolve-plugins.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

afterEach(() => {
  clearPluginResolveCache()
  vi.restoreAllMocks()
})

/** Порожній mock-обробник для spyOn(console.warn) — глушить вивід у тестах. */
function noop() {
  /* навмисно порожньо */
}

/**
 * Створює фейковий встановлений плагін у node_modules tmp-репо.
 * @param {string} dir корінь tmp-репо
 * @param {string} name npm-ім'я плагіна
 * @param {{ manifest?: object, withRules?: boolean }} [opts] manifest — блок n-rules; withRules=false — без rules/
 */
async function writeFakePlugin(dir, name, opts = {}) {
  const root = join(dir, 'node_modules', name)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', 'n-rules': opts.manifest }))
  if (opts.withRules !== false) {
    const ruleDir = join(root, 'rules', 'fake-rule')
    await mkdir(ruleDir, { recursive: true })
    await writeFile(join(ruleDir, 'main.json'), JSON.stringify({ auto: 'завжди' }))
    await writeFile(join(ruleDir, 'main.mdc'), '---\ndescription: fake\n---\nfake\n')
  }
}

describe('detectPluginsFromRepo', () => {
  test('.github/workflows з yml → ci-github', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github'])
    })
  })

  test('azure-pipelines.yml → ci-azure', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'azure-pipelines.yml'), 'trigger: [main]\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-azure'])
    })
  })

  test('обидва файлові сигнали → обидва плагіни', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
      await writeFile(join(dir, 'azure-pipelines.yml'), 'trigger: [main]\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github', '@7n/rules-ci-azure'])
    })
  })

  test('порожній .github/workflows → fallback на repository.url (dev.azure.com)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ repository: { url: 'git+https://dev.azure.com/org/proj/_git/repo' } })
      )
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-azure'])
    })
  })

  test('repository як string з github.com → ci-github', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'github:nitra/7n-rules' }))
      expect(detectPluginsFromRepo(dir)).toEqual([])
      await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'https://github.com/nitra/7n-rules' }))
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github'])
    })
  })

  test('жодного сигналу → []', async () => {
    await withTmpDir(dir => {
      expect(detectPluginsFromRepo(dir)).toEqual([])
    })
  })

  test('pyproject.toml → lang-python (незалежно від CI-сигналів)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-lang-python'])

      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github', '@7n/rules-lang-python'])
    })
  })

  test('кореневий Cargo.toml → lang-rust; разом із pyproject — обидва мовні', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-lang-rust'])

      await writeFile(join(dir, 'pyproject.toml'), '[project]\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-lang-python', '@7n/rules-lang-rust'])
    })
  })

  test('lang-сигнал не вмикає URL-fallback для CI', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\n')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'https://github.com/nitra/x' }))
      // CI-детект: файлових CI-сигналів нема → URL-fallback дає ci-github; lang — окремо.
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github', '@7n/rules-lang-python'])
    })
  })
})

describe('resolvePluginList', () => {
  test('config.plugins перекриває автодетект; [] = вимкнено', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'azure-pipelines.yml'), 'trigger: [main]\n')
      expect(resolvePluginList(dir, { plugins: ['@x/custom'] })).toEqual(['@x/custom'])
      expect(resolvePluginList(dir, { plugins: [] })).toEqual([])
      expect(resolvePluginList(dir, {})).toEqual(['@7n/rules-ci-azure'])
      expect(resolvePluginList(dir, null)).toEqual(['@7n/rules-ci-azure'])
    })
  })
})

describe('resolvePlugins', () => {
  test('встановлений плагін резолвиться з manifest-ом', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@7n/rules-ci-azure', {
        manifest: { capabilities: ['ci:azure'], contributes: { handlers: { 'doc-files': './handlers/x.mjs' } } }
      })
      const plugins = resolvePlugins(dir, { plugins: ['@7n/rules-ci-azure'] })
      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('@7n/rules-ci-azure')
      expect(plugins[0].rulesDir.endsWith(join('node_modules', '@7n/rules-ci-azure', 'rules'))).toBe(true)
      expect(plugins[0].manifest.capabilities).toEqual(['ci:azure'])
    })
  })

  test('невстановлений плагін при allowInstall:false — warning + skip', async () => {
    await withTmpDir(dir => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      const plugins = resolvePlugins(dir, { plugins: ['@7n/rules-ci-github'] }, { allowInstall: false })
      expect(plugins).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('@7n/rules-ci-github'))
    })
  })

  test('плагін без rules/, що ДЕКЛАРУЄ правила — warning + skip (битий пакет)', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/no-rules', { withRules: false })
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      expect(resolvePlugins(dir, { plugins: ['@x/no-rules'] }, { allowInstall: false })).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('без каталогу rules/'))
    })
  })

  test('плагін без rules/ з contributes.rules:false — легальний (лише handlers, як lang-*)', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@7n/rules-lang-python', {
        withRules: false,
        manifest: {
          capabilities: ['lang:python'],
          contributes: { rules: false, handlers: { taze: './taze/provider.mjs' } }
        }
      })
      const plugins = resolvePlugins(dir, { plugins: ['@7n/rules-lang-python'] }, { allowInstall: false })
      expect(plugins).toHaveLength(1)
      expect(plugins[0].manifest.contributes.rules).toBe(false)

      // resolveRulesDirs НЕ включає такий плагін (нема що зливати).
      const dirs = resolveRulesDirs(dir, { plugins: ['@7n/rules-lang-python'] }, '/bundled/rules', {
        allowInstall: false
      })
      expect(dirs.map(d => d.name)).toEqual(['@7n/rules'])

      // Але handlers і capabilities доступні.
      expect(getHandlers(dir, { plugins: ['@7n/rules-lang-python'] }, 'taze')).toHaveLength(1)
      const caps = getActiveCapabilities(dir, { plugins: ['@7n/rules-lang-python'] }, { allowInstall: false })
      expect([...caps]).toEqual(['lang:python'])
    })
  })

  test('кеш: другий виклик повертає той самий масив', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/p', {})
      const a = resolvePlugins(dir, { plugins: ['@x/p'] }, { allowInstall: false })
      const b = resolvePlugins(dir, { plugins: ['@x/p'] }, { allowInstall: false })
      expect(b).toBe(a)
    })
  })
})

describe('ensurePluginInstalled', () => {
  test('уже встановлений → true без bun add', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/p', {})
      expect(ensurePluginInstalled(dir, '@x/p')).toBe(true)
    })
  })

  test('без package.json проєкту → false', async () => {
    await withTmpDir(dir => {
      expect(ensurePluginInstalled(dir, '@x/p')).toBe(false)
    })
  })
})

describe('resolveRulesDirs / capabilities / handlers', () => {
  test('ядро завжди перше, плагіни за ним', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/p', { manifest: { capabilities: ['ci:azure'] } })
      const dirs = resolveRulesDirs(dir, { plugins: ['@x/p'] }, '/bundled/rules', { allowInstall: false })
      expect(dirs.map(d => d.name)).toEqual(['@7n/rules', '@x/p'])
      expect(dirs[0].rulesDir).toBe('/bundled/rules')
    })
  })

  test('getActiveCapabilities агрегує з усіх плагінів', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/a', { manifest: { capabilities: ['ci:github', 'x:y'] } })
      await writeFakePlugin(dir, '@x/b', { manifest: { capabilities: ['ci:azure'] } })
      const caps = getActiveCapabilities(dir, { plugins: ['@x/a', '@x/b'] }, { allowInstall: false })
      expect([...caps].toSorted()).toEqual(['ci:azure', 'ci:github', 'x:y'])
    })
  })

  test('getHandlers повертає абсолютні шляхи модулів', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/lang-rust', {
        manifest: { contributes: { handlers: { 'doc-files': './handlers/rust.mjs' } } }
      })
      const handlers = getHandlers(dir, { plugins: ['@x/lang-rust'] }, 'doc-files')
      expect(handlers).toHaveLength(1)
      expect(handlers[0].pluginName).toBe('@x/lang-rust')
      expect(handlers[0].modulePath.endsWith(join('@x/lang-rust', 'handlers/rust.mjs'))).toBe(true)
      expect(getHandlers(dir, { plugins: ['@x/lang-rust'] }, 'unknown')).toEqual([])
    })
  })
})
