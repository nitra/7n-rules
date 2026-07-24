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
  getUnavailableDeclaredPlugins,
  pluginCategory,
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
      // package.json (джерело repository.url) — це і сигнал lang-js (фаза 5a).
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-azure', '@7n/rules-lang-js'])
    })
  })

  test('repository як string з github.com → ci-github (+ lang-js за package.json)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'github:nitra/7n-rules' }))
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-lang-js'])
      await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'https://github.com/nitra/7n-rules' }))
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github', '@7n/rules-lang-js'])
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

  test('вкладений Cargo.toml (монорепо, Tauri-глибина) → lang-rust; за межею глибини — ні', async () => {
    await withTmpDir(async dir => {
      // Глибина 2 (app/src-tauri) — типовий Tauri-монорепо кейс.
      await mkdir(join(dir, 'app', 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname = "x"\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-lang-rust'])
    })

    await withTmpDir(async dir => {
      // Глибина 4 — за межею maxDepth 3, не детектиться.
      await mkdir(join(dir, 'a', 'b', 'c', 'd'), { recursive: true })
      await writeFile(join(dir, 'a', 'b', 'c', 'd', 'Cargo.toml'), '[package]\n')
      expect(detectPluginsFromRepo(dir)).toEqual([])
    })
  })

  test('скан не заходить у приховані/службові теки (node_modules, target, .dot)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true })
      await writeFile(join(dir, 'node_modules', 'dep', 'Cargo.toml'), '[package]\n')
      await mkdir(join(dir, 'target', 'debug'), { recursive: true })
      await writeFile(join(dir, 'target', 'Cargo.toml'), '[package]\n')
      await mkdir(join(dir, '.worktrees', 'wt'), { recursive: true })
      await writeFile(join(dir, '.worktrees', 'wt', 'Cargo.toml'), '[package]\n')
      expect(detectPluginsFromRepo(dir)).toEqual([])
    })
  })

  test('вкладений pyproject.toml НЕ детектиться (python — лише корінь, uv v1)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'services', 'api'), { recursive: true })
      await writeFile(join(dir, 'services', 'api', 'pyproject.toml'), '[project]\n')
      expect(detectPluginsFromRepo(dir)).toEqual([])
    })
  })

  test('lang-сигнал не вмикає URL-fallback для CI', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\n')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: 'https://github.com/nitra/x' }))
      // CI-детект: файлових CI-сигналів нема → URL-fallback дає ci-github; lang — окремо
      // (package.json тут — і джерело repository.url, і сигнал lang-js).
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github', '@7n/rules-lang-js', '@7n/rules-lang-python'])
    })
  })
})

describe('pluginCategory', () => {
  test('витягує категорію з @7n/rules-<category>-<name>', () => {
    expect(pluginCategory('@7n/rules-ci-github')).toBe('ci')
    expect(pluginCategory('@7n/rules-ci-azure')).toBe('ci')
    expect(pluginCategory('@7n/rules-lang-js')).toBe('lang')
    expect(pluginCategory('@7n/rules-lang-rust')).toBe('lang')
  })

  test('поза naming convention → null', () => {
    expect(pluginCategory('@x/custom')).toBeNull()
    expect(pluginCategory('@7n/rules')).toBeNull()
  })
})

describe('resolvePluginList', () => {
  test('плагін поза naming convention у списку — старий all-or-nothing; [] = вимкнено', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'azure-pipelines.yml'), 'trigger: [main]\n')
      // Сторонній (не @7n/rules-*) пакет у declared — не вгадуємо намір, backfill вимкнено.
      expect(resolvePluginList(dir, { plugins: ['@x/custom'] })).toEqual(['@x/custom'])
      expect(resolvePluginList(dir, { plugins: [] })).toEqual([])
      expect(resolvePluginList(dir, {})).toEqual(['@7n/rules-ci-azure'])
      expect(resolvePluginList(dir, null)).toEqual(['@7n/rules-ci-azure'])
    })
  })

  test('непорожній declared без lang-категорії → lang домішується автодетектом (ADR 260719-2154)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      expect(resolvePluginList(dir, { plugins: ['@7n/rules-ci-github'] })).toEqual([
        '@7n/rules-ci-github',
        '@7n/rules-lang-js'
      ])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('@7n/rules-lang-js'))
    })
  })

  test('quiet:true — backfill спрацьовує без warning-у', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      expect(resolvePluginList(dir, { plugins: ['@7n/rules-ci-github'] }, { quiet: true })).toEqual([
        '@7n/rules-ci-github',
        '@7n/rules-lang-js'
      ])
      expect(warn).not.toHaveBeenCalled()
    })
  })

  test('повторний виклик з тими самими аргументами — кеш, warning не дублюється', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      // Реальний виклик у n-rules.js: напряму (readConfig) + всередині resolveRulesDirs →
      // resolvePlugins — той самий (projectRoot, declared) не повинен друкувати warning двічі.
      const config = { plugins: ['@7n/rules-ci-github'] }
      const a = resolvePluginList(dir, config)
      const b = resolvePluginList(dir, config)
      expect(b).toBe(a)
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })

  test('declared: [] — і далі «усі плагіни вимкнено», backfill не застосовується попри сигнали', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
      expect(resolvePluginList(dir, { plugins: [] })).toEqual([])
    })
  })

  test('declared з усіма відомими категоріями — автодетект не викликається (не марнує файлові сигнали)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const declared = ['@7n/rules-ci-github', '@7n/rules-ci-azure', '@7n/rules-lang-js']
      expect(resolvePluginList(dir, { plugins: declared })).toEqual(declared)
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

describe('getUnavailableDeclaredPlugins', () => {
  test('задекларований, але не встановлений плагін — у списку, без console.warn', async () => {
    await withTmpDir(dir => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      expect(getUnavailableDeclaredPlugins(dir, { plugins: ['@7n/rules-lang-js'] })).toEqual(['@7n/rules-lang-js'])
      expect(warn).not.toHaveBeenCalled()
    })
  })

  test('встановлений плагін — не потрапляє у список', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@7n/rules-lang-js', {})
      expect(getUnavailableDeclaredPlugins(dir, { plugins: ['@7n/rules-lang-js'] })).toEqual([])
    })
  })

  test('немає config.plugins — порожній список', async () => {
    await withTmpDir(dir => {
      expect(getUnavailableDeclaredPlugins(dir, {})).toEqual([])
      expect(getUnavailableDeclaredPlugins(dir, null)).toEqual([])
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
