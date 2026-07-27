/**
 * Тести резолву плагінів: детект за файлами/repository.url, пріоритет config.plugins,
 * graceful skip невстановлених, читання маніфесту (capabilities/requiresPluginApi/slots), кеш.
 *
 * Composition-поверхні (rules.directory, taze.provider, coverage.provider, doc-files.*,
 * skills.fragment) переїхали на `plugin-slots.mjs` (Фаза 2, spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction) — їхні тести там-таки, разом з
 * broker-тестами Фази 1 (`plugin-slots.test.mjs`).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  clearPluginResolveCache,
  detectPluginsFromRepo,
  ensurePluginInstalled,
  getUnavailableDeclaredPlugins,
  KNOWN_PLUGIN_RANGES,
  pluginCategory,
  resolvePluginList,
  resolvePlugins
} from '../resolve-plugins.mjs'
import { PLUGIN_API_VERSION } from '../plugin-api.mjs'
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
 * Синхронно матеріалізує фейковий встановлений пакет у `node_modules` — імітує ефект
 * реального `bun add` усередині фейкового `spawnFn` (spawnSync — синхронний, тому заглушка
 * теж лишається синхронною; `existsSync(installed)` після виклику інакше бачив би порожньо).
 * @param {string} dir корінь tmp-репо
 * @param {string} name npm-ім'я пакета
 */
function materializeFakePluginSync(dir, name) {
  const root = join(dir, 'node_modules', name)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
}

/**
 * Створює фейковий встановлений плагін у node_modules tmp-репо (без фізичного `rules/` —
 * legacy `contributes.rules`-гейт видалено Фазою 2, resolvePlugins() більше не вимагає
 * каталогу правил для жодного плагіна).
 * @param {string} dir корінь tmp-репо
 * @param {string} name npm-ім'я плагіна
 * @param {{ manifest?: object }} [opts] manifest — блок n-rules
 */
async function writeFakePlugin(dir, name, opts = {}) {
  const root = join(dir, 'node_modules', name)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', 'n-rules': opts.manifest }))
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

  test('composer.json → lang-php (незалежно від CI-сигналів)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{"name": "acme/demo"}\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-lang-php'])

      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
      expect(detectPluginsFromRepo(dir)).toEqual(['@7n/rules-ci-github', '@7n/rules-lang-php'])
    })
  })

  test('вкладений composer.json НЕ детектиться (php — лише корінь, maxDepth 0)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'services', 'api'), { recursive: true })
      await writeFile(join(dir, 'services', 'api', 'composer.json'), '{"name": "acme/api"}\n')
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
      // Реальний виклик у n-rules.js: напряму (readConfig) + всередині resolveSlotGraph →
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
  test('встановлений плагін резолвиться з manifest-ом (без вимоги фізичного rules/)', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@7n/rules-ci-azure', { manifest: { capabilities: ['ci:azure'] } })
      const plugins = resolvePlugins(dir, { plugins: ['@7n/rules-ci-azure'] })
      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('@7n/rules-ci-azure')
      expect(plugins[0].packageRoot.endsWith(join('node_modules', '@7n/rules-ci-azure'))).toBe(true)
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

  test('плагін без rules/ — легальний (legacy contributes.rules-гейт видалено Фазою 2)', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@7n/rules-lang-python', { manifest: { capabilities: ['lang:python'] } })
      const plugins = resolvePlugins(dir, { plugins: ['@7n/rules-lang-python'] }, { allowInstall: false })
      expect(plugins).toHaveLength(1)
      expect(plugins[0].manifest.capabilities).toEqual(['lang:python'])
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

  test('requiresPluginApi > PLUGIN_API_VERSION — warning з required/actual, плагін пропускається', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/future', {
        manifest: { requiresPluginApi: PLUGIN_API_VERSION + 1, capabilities: ['x:y'] }
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      expect(resolvePlugins(dir, { plugins: ['@x/future'] }, { allowInstall: false })).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('@x/future'))
      const [message] = warn.mock.calls[0]
      expect(message).toContain(`v${PLUGIN_API_VERSION + 1}`)
      expect(message).toContain(`v${PLUGIN_API_VERSION}`)
    })
  })

  test('requiresPluginApi несумісний + quiet:true — пропуск без warning', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/future', {
        manifest: { requiresPluginApi: PLUGIN_API_VERSION + 1 }
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      expect(resolvePlugins(dir, { plugins: ['@x/future'] }, { allowInstall: false, quiet: true })).toEqual([])
      expect(warn).not.toHaveBeenCalled()
    })
  })

  test('requiresPluginApi <= PLUGIN_API_VERSION — сумісний, резолвиться як звичайно', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/compatible', {
        manifest: { requiresPluginApi: PLUGIN_API_VERSION, capabilities: ['x:y'] }
      })
      const plugins = resolvePlugins(dir, { plugins: ['@x/compatible'] }, { allowInstall: false })
      expect(plugins).toHaveLength(1)
      expect(plugins[0].manifest.requiresPluginApi).toBe(PLUGIN_API_VERSION)
    })
  })

  test('без requiresPluginApi у маніфесті — сумісний, як і раніше (сире значення лишається undefined)', async () => {
    await withTmpDir(async dir => {
      await writeFakePlugin(dir, '@x/legacy', { manifest: { capabilities: ['x:y'] } })
      const plugins = resolvePlugins(dir, { plugins: ['@x/legacy'] }, { allowInstall: false })
      expect(plugins).toHaveLength(1)
      // Маніфест тримає СИРЕ requiresPluginApi (його друкує slot-broker у diagnostics);
      // нормалізацію «нечислове/відсутнє → сумісний» робить isIncompatiblePluginApi.
      expect(plugins[0].manifest.requiresPluginApi).toBeUndefined()
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

  test('first-party пакет — bun add -d викликається з @<range> з KNOWN_PLUGIN_RANGES', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const spawnFn = vi.fn(() => {
        // Імітуємо успішну установку: реальний bun add створив би пакет у node_modules.
        materializeFakePluginSync(dir, '@7n/rules-lang-js')
        return { status: 0, stdout: '', stderr: '' }
      })
      const ok = ensurePluginInstalled(dir, '@7n/rules-lang-js', spawnFn)
      expect(ok).toBe(true)
      expect(spawnFn).toHaveBeenCalledWith(
        'bun',
        ['add', '-d', `@7n/rules-lang-js@${KNOWN_PLUGIN_RANGES['@7n/rules-lang-js']}`],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('невідомий (сторонній) пакет — bun add -d викликається без обмеження версії', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const spawnFn = vi.fn(() => {
        materializeFakePluginSync(dir, '@x/custom')
        return { status: 0, stdout: '', stderr: '' }
      })
      const ok = ensurePluginInstalled(dir, '@x/custom', spawnFn)
      expect(ok).toBe(true)
      expect(spawnFn).toHaveBeenCalledWith('bun', ['add', '-d', '@x/custom'], expect.objectContaining({ cwd: dir }))
    })
  })

  test('фейл установки (spawnFn повертає ненульовий status) — warning + false', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      const spawnFn = vi.fn(() => ({ status: 1, stdout: '', stderr: 'offline' }))
      expect(ensurePluginInstalled(dir, '@7n/rules-lang-python', spawnFn)).toBe(false)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('@7n/rules-lang-python'))
    })
  })
})
