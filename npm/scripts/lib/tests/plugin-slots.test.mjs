/**
 * Тести universal typed slot bus (`plugin-slots.mjs`, spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction, Фаза 1 — slot broker acceptance §12):
 * envelope validation, стабільний детермінований порядок, capability-фільтрація до читання
 * resource, path traversal/symlink escape, no-consumer silent no-op, version mismatch і
 * duplicate id з actionable provenance, відсутність consumer-handler-import під час discovery,
 * cache reset, sync-контракт `resolveSlotGraph`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  clearSlotResolveCache,
  getActiveCapabilities,
  getSlotConsumers,
  getSlotContributions,
  loadSlotConsumer,
  resolveRulesDirs,
  resolveSlotGraph
} from '../plugin-slots.mjs'
import { clearPluginResolveCache } from '../resolve-plugins.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

const DOT_PREFIX_RE = /^\.\//u
const MISSING_ID_RE = /id/u
const MISSING_VALIDATE_RE = /validate/u

afterEach(() => {
  clearSlotResolveCache()
  clearPluginResolveCache()
  vi.restoreAllMocks()
})

/**
 * Ставить у tmp-репо фейковий плагін API v2 (`requiresPluginApi: 2`, `slots.{provides,consumes}`).
 * За замовчуванням `contributes.rules: false` — легасі `resolvePlugins()` інакше вимагав би
 * фізичний каталог `rules/`, якого slots-only плагін не має (контракт rules.directory@1 —
 * інша річ, ніж legacy `contributes.rules`).
 * @param {string} dir корінь tmp-репо
 * @param {string} name npm-ім'я плагіна
 * @param {{ requiresPluginApi?: unknown, capabilities?: string[], provides?: object[], consumes?: object[], rawPackageJson?: string }} [opts] маніфест
 * @returns {Promise<string>} абсолютний packageRoot плагіна
 */
async function writeFakeSlotPlugin(dir, name, opts = {}) {
  const packageRoot = join(dir, 'node_modules', name)
  await mkdir(packageRoot, { recursive: true })
  if (typeof opts.rawPackageJson === 'string') {
    await writeFile(join(packageRoot, 'package.json'), opts.rawPackageJson)
  } else {
    const nRules = {
      requiresPluginApi: 'requiresPluginApi' in opts ? opts.requiresPluginApi : 2,
      capabilities: opts.capabilities ?? [],
      contributes: { rules: false },
      slots: { provides: opts.provides ?? [], consumes: opts.consumes ?? [] }
    }
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version: '1.0.0', 'n-rules': nRules }))
  }
  return packageRoot
}

/**
 * Пише текстовий файл-ресурс за package-relative шляхом (`./sub/dir/file.txt`) усередині
 * `packageRoot` — для contribution `resource`/consumer `handler`.
 * @param {string} packageRoot корінь пакета
 * @param {string} relPath package-relative шлях (з `./`)
 * @param {string} [content] вміст файлу
 * @returns {Promise<void>}
 */
async function writeResource(packageRoot, relPath, content = '{}') {
  const abs = join(packageRoot, relPath.replace(DOT_PREFIX_RE, ''))
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content)
}

describe('resolveSlotGraph — sync-контракт і кеш', () => {
  test('повертає звичайний обʼєкт синхронно, без Promise', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/empty', {})
      const result = resolveSlotGraph(dir, { plugins: ['@x/empty'] }, { allowInstall: false, quiet: true })
      expect(result).not.toBeInstanceOf(Promise)
      expect(typeof result.then).not.toBe('function')
      expect(Array.isArray(result.contributions)).toBe(true)
      expect(Array.isArray(result.consumers)).toBe(true)
      expect(Array.isArray(result.diagnostics)).toBe(true)
    })
  })

  test('повторний виклик з тими самими аргументами — та сама (кешована) референція', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/empty', {})
      const config = { plugins: ['@x/empty'] }
      const a = resolveSlotGraph(dir, config, { allowInstall: false, quiet: true })
      const b = resolveSlotGraph(dir, config, { allowInstall: false, quiet: true })
      expect(b).toBe(a)
    })
  })

  test('clearSlotResolveCache() скидає кеш — наступний виклик повертає нову референцію', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/empty', {})
      const config = { plugins: ['@x/empty'] }
      const a = resolveSlotGraph(dir, config, { allowInstall: false, quiet: true })
      clearSlotResolveCache()
      const b = resolveSlotGraph(dir, config, { allowInstall: false, quiet: true })
      expect(b).not.toBe(a)
      expect(b).toEqual(a)
    })
  })

  test('граф заморожений (top-level) — Array.prototype.push на замороженому масиві кидає', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/empty', {})
      const graph = resolveSlotGraph(dir, { plugins: ['@x/empty'] }, { allowInstall: false, quiet: true })
      expect(Object.isFrozen(graph)).toBe(true)
      expect(Object.isFrozen(graph.contributions)).toBe(true)
      expect(Object.isFrozen(graph.diagnostics)).toBe(true)
      expect(() => {
        graph.contributions.push({})
      }).toThrow()
    })
  })
})

describe('resolveSlotGraph — requiresPluginApi gate (§9.2)', () => {
  test('плагін без requiresPluginApi не входить у граф — warning diagnostic, contributions ігноруються', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/legacy', {
        requiresPluginApi: undefined,
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', value: 1 }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/legacy'] }, { allowInstall: false, quiet: true })
      expect(graph.plugins).toEqual([])
      expect(graph.contributions).toEqual([])
      expect(graph.diagnostics).toEqual([
        expect.objectContaining({ severity: 'warning', code: 'plugin-api-version-skip', plugin: '@x/legacy' })
      ])
    })
  })

  test('плагін зі старим requiresPluginApi (1) так само не входить у граф', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/v1', { requiresPluginApi: 1 })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/v1'] }, { allowInstall: false, quiet: true })
      expect(graph.plugins).toEqual([])
      expect(graph.diagnostics[0].code).toBe('plugin-api-version-skip')
      expect(graph.diagnostics[0].message).toContain('1')
    })
  })

  test('requiresPluginApi: 2 — плагін входить у graph.plugins', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/v2', {})
      const graph = resolveSlotGraph(dir, { plugins: ['@x/v2'] }, { allowInstall: false, quiet: true })
      expect(graph.plugins).toEqual([{ name: '@x/v2', packageRoot: expect.stringContaining('@x/v2') }])
    })
  })
})

describe('resolveSlotGraph — manifest parse failure (§9.1)', () => {
  test('битий JSON package.json — diagnostic manifest-parse-error, плагін не в graph.plugins', async () => {
    await withTmpDir(async dir => {
      // rules/ обов'язковий, інакше legacy resolvePlugins() сам відфільтрує плагін ДО того,
      // як plugin-slots взагалі його побачить (contributes.rules fallback — true).
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/broken', { rawPackageJson: '{ не валідний json' })
      await mkdir(join(packageRoot, 'rules', 'fake'), { recursive: true })
      await writeFile(join(packageRoot, 'rules', 'fake', 'main.json'), JSON.stringify({ auto: 'завжди' }))

      const graph = resolveSlotGraph(dir, { plugins: ['@x/broken'] }, { allowInstall: false, quiet: true })
      expect(graph.plugins).toEqual([])
      expect(graph.diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', code: 'manifest-parse-error', plugin: '@x/broken' })
      ])
    })
  })
})

describe('resolveSlotGraph — детермінований порядок (spec рішення З)', () => {
  test('contributions у порядку resolved plugin order → manifest order, незалежно від порядку створення файлів на диску', async () => {
    await withTmpDir(async dir => {
      // Фізично створюємо плагін Б РАНІШЕ за А на диску — якби порядок залежав від
      // filesystem-enumeration (readdir node_modules), Б випереджав би А в результаті.
      await writeFakeSlotPlugin(dir, '@x/plugin-b', {
        provides: [
          { slot: 'demo.widget', version: 1, id: 'b-zero', value: 'b0' },
          { slot: 'demo.widget', version: 1, id: 'b-one', value: 'b1' }
        ]
      })
      await writeFakeSlotPlugin(dir, '@x/plugin-a', {
        provides: [
          { slot: 'demo.widget', version: 1, id: 'a-zero', value: 'a0' },
          { slot: 'demo.widget', version: 1, id: 'a-one', value: 'a1' }
        ]
      })

      // Явний config.plugins визначає резолвлений порядок: А раніше Б.
      const graph = resolveSlotGraph(
        dir,
        { plugins: ['@x/plugin-a', '@x/plugin-b'] },
        { allowInstall: false, quiet: true }
      )
      expect(graph.contributions.map(c => c.id)).toEqual(['a-zero', 'a-one', 'b-zero', 'b-one'])
    })
  })
})

describe('resolveSlotGraph — capability filtering (§3.2, §12 acceptance)', () => {
  test('capability активна (від іншого плагіна) — contribution доступна через getSlotContributions', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/ci-github', { capabilities: ['ci:github'] })
      const consumer = await writeFakeSlotPlugin(dir, '@x/consumer', {
        consumes: [{ slot: 'ci.artifact', versions: [1], handler: './handler.mjs' }]
      })
      await writeResource(consumer, './handler.mjs', 'export default { id: "c", validate: () => true }')
      const contributor = await writeFakeSlotPlugin(dir, '@x/lang-php', {
        provides: [
          {
            slot: 'ci.artifact',
            version: 1,
            id: 'php-gh',
            resource: './artifact.json',
            requires: { capabilities: ['ci:github'] }
          }
        ]
      })
      await writeResource(contributor, './artifact.json', '{"ok":true}')

      const graph = resolveSlotGraph(
        dir,
        { plugins: ['@x/ci-github', '@x/consumer', '@x/lang-php'] },
        { allowInstall: false, quiet: true }
      )
      // Порядок появи capability у списку плагінів (ci-github — ПЕРШИЙ) не мав би значення:
      // повний набір capabilities збирається окремим проходом ДО валідації contributions.
      const got = getSlotContributions(graph, 'ci.artifact', [1])
      expect(got).toHaveLength(1)
      expect(got[0].id).toBe('php-gh')
      expect(graph.diagnostics.filter(d => d.code === 'missing-resource')).toEqual([])
    })
  })

  test('capability НЕактивна — contribution відфільтрована ДО читання resource: жодного missing-resource diagnostic для неіснуючого шляху', async () => {
    await withTmpDir(async dir => {
      // НАВМИСНО не пишемо ./does-not-exist.json — capability вимкнена, тож resource
      // ніколи не має перевірятись на існування.
      await writeFakeSlotPlugin(dir, '@x/lang-php', {
        provides: [
          {
            slot: 'ci.artifact',
            version: 1,
            id: 'php-gh',
            resource: './does-not-exist.json',
            requires: { capabilities: ['ci:github'] }
          }
        ]
      })

      const graph = resolveSlotGraph(dir, { plugins: ['@x/lang-php'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics).toEqual([])
      expect(getSlotContributions(graph, 'ci.artifact', [1])).toEqual([])
      // Contribution лишається видимою у графі (інспекція/діагностика), просто відфільтрована query-функцією.
      expect(graph.contributions).toHaveLength(1)
      expect(graph.contributions[0].requires.capabilities).toEqual(['ci:github'])
    })
  })
})

describe('resolveSlotGraph — path safety (traversal/absolute/symlink escape, §9.3)', () => {
  test('".." сегмент у resource — unsafe-resource-path, contribution не входить у граф', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/evil', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: '../../etc/passwd' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/evil'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toEqual([])
      expect(graph.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'unsafe-resource-path' })])
    })
  })

  test('абсолютний шлях у resource — unsafe-resource-path', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/evil', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: '/etc/passwd' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/evil'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toEqual([])
      expect(graph.diagnostics[0].code).toBe('unsafe-resource-path')
    })
  })

  test('resource без префікса "./" — unsafe-resource-path', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/evil', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: 'rules.json' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/evil'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('unsafe-resource-path')
    })
  })

  test('symlink escape за межі packageRoot — unsafe-resource-path (containment за realpath)', async () => {
    await withTmpDir(async dir => {
      const outsideTarget = join(dir, 'outside-secret.json')
      await writeFile(outsideTarget, '{"secret":true}')
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/evil', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: './escape-link' }]
      })
      await symlink(outsideTarget, join(packageRoot, 'escape-link'))

      const graph = resolveSlotGraph(dir, { plugins: ['@x/evil'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toEqual([])
      expect(graph.diagnostics[0].code).toBe('unsafe-resource-path')
      expect(graph.diagnostics[0].message).toContain('symlink')
    })
  })

  test('той самий набір перевірок для consumer.handler', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/evil-consumer', {
        consumes: [{ slot: 'demo.widget', versions: [1], handler: '../../evil.mjs' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/evil-consumer'] }, { allowInstall: false, quiet: true })
      expect(graph.consumers).toEqual([])
      expect(graph.diagnostics[0].code).toBe('unsafe-handler-path')
    })
  })
})

describe('resolveSlotGraph — missing resource (§9.4, capability задоволена)', () => {
  test('безпечний, але неіснуючий resource — missing-resource, plugin/slot/id/path у message', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/broken-resource', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: './nope.json' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/broken-resource'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toEqual([])
      const [d] = graph.diagnostics
      expect(d.code).toBe('missing-resource')
      expect(d.plugin).toBe('@x/broken-resource')
      expect(d.slot).toBe('demo.widget')
      expect(d.message).toContain('w')
      expect(d.message).toContain('nope.json')
    })
  })
})

describe('resolveSlotGraph — no-consumer silent no-op (§9.5)', () => {
  test('contribution без жодного зареєстрованого consumer-а слоту — жодного diagnostic', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/orphan', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: './r.json' }]
      })
      await writeResource(packageRoot, './r.json')
      const graph = resolveSlotGraph(dir, { plugins: ['@x/orphan'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toHaveLength(1)
      expect(graph.diagnostics).toEqual([])
    })
  })
})

describe('resolveSlotGraph — version mismatch (§9.6) з actionable provenance', () => {
  test('consumer існує, але не підтримує версію contribution — hard error з provenance обох сторін', async () => {
    await withTmpDir(async dir => {
      const consumerRoot = await writeFakeSlotPlugin(dir, '@x/consumer', {
        consumes: [{ slot: 'demo.widget', versions: [2], handler: './handler.mjs' }]
      })
      await writeResource(consumerRoot, './handler.mjs', 'export default { id: "c", validate: () => true }')
      const providerRoot = await writeFakeSlotPlugin(dir, '@x/provider', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: './r.json' }]
      })
      await writeResource(providerRoot, './r.json')

      const graph = resolveSlotGraph(
        dir,
        { plugins: ['@x/consumer', '@x/provider'] },
        { allowInstall: false, quiet: true }
      )
      const [d] = graph.diagnostics
      expect(d.code).toBe('version-mismatch')
      expect(d.severity).toBe('error')
      expect(d.plugin).toBe('@x/provider')
      expect(d.slot).toBe('demo.widget')
      expect(d.version).toBe(1)
      expect(d.message).toContain('w')
      expect(d.message).toContain('@x/consumer')
      expect(d.message).toContain('2')
    })
  })

  test('версія збігається — жодного version-mismatch', async () => {
    await withTmpDir(async dir => {
      const consumerRoot = await writeFakeSlotPlugin(dir, '@x/consumer', {
        consumes: [{ slot: 'demo.widget', versions: [1, 2], handler: './handler.mjs' }]
      })
      await writeResource(consumerRoot, './handler.mjs', 'export default { id: "c", validate: () => true }')
      const providerRoot = await writeFakeSlotPlugin(dir, '@x/provider', {
        provides: [{ slot: 'demo.widget', version: 2, id: 'w', resource: './r.json' }]
      })
      await writeResource(providerRoot, './r.json')

      const graph = resolveSlotGraph(
        dir,
        { plugins: ['@x/consumer', '@x/provider'] },
        { allowInstall: false, quiet: true }
      )
      expect(graph.diagnostics).toEqual([])
    })
  })
})

describe('resolveSlotGraph — duplicate contribution id (§9.9)', () => {
  test('дубль (plugin, slot, version, id) у межах одного плагіна — hard error, лишається лише перша', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/dup', {
        provides: [
          { slot: 'demo.widget', version: 1, id: 'same', value: 'first' },
          { slot: 'demo.widget', version: 1, id: 'same', value: 'second' }
        ]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/dup'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toHaveLength(1)
      expect(graph.contributions[0].value).toBe('first')
      expect(graph.diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', code: 'duplicate-contribution', plugin: '@x/dup' })
      ])
    })
  })

  test('однаковий id у РІЗНИХ плагінів — легально (id — plugin-local)', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/one', { provides: [{ slot: 'demo.widget', version: 1, id: 'w', value: 1 }] })
      await writeFakeSlotPlugin(dir, '@x/two', { provides: [{ slot: 'demo.widget', version: 1, id: 'w', value: 2 }] })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/one', '@x/two'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toHaveLength(2)
      expect(graph.diagnostics).toEqual([])
    })
  })
})

describe('resolveSlotGraph — envelope validation (§3.2/§3.3)', () => {
  test('resource і value одночасно — invalid-payload-shape', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/both', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', resource: './r.json', value: 1 }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/both'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-payload-shape')
    })
  })

  test('ні resource, ні value — invalid-payload-shape', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/neither', { provides: [{ slot: 'demo.widget', version: 1, id: 'w' }] })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/neither'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-payload-shape')
    })
  })

  test('заборонене поле priority — forbidden-field', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/priority-field', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'w', value: 1, priority: 1 }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/priority-field'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('forbidden-field')
    })
  })

  test('slot з одним сегментом (без крапки/дефіса) — invalid-slot-id', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/bad-slot', { provides: [{ slot: 'widget', version: 1, id: 'w', value: 1 }] })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/bad-slot'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-slot-id')
    })
  })

  test('id з великими літерами — invalid-contribution-id', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/bad-id', {
        provides: [{ slot: 'demo.widget', version: 1, id: 'BadId', value: 1 }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/bad-id'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-contribution-id')
    })
  })

  test('нецілий/недодатний version — invalid-version', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/bad-version', {
        provides: [{ slot: 'demo.widget', version: 0, id: 'w', value: 1 }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/bad-version'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-version')
    })
  })

  test('consumer versions: порожній масив — invalid-consumer-versions', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/empty-versions', {
        consumes: [{ slot: 'demo.widget', versions: [], handler: './h.mjs' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/empty-versions'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-consumer-versions')
    })
  })

  test('consumer versions: дублікати — invalid-consumer-versions', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/dup-versions', {
        consumes: [{ slot: 'demo.widget', versions: [1, 1], handler: './h.mjs' }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/dup-versions'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-consumer-versions')
    })
  })

  test('невідома форма slots.provides (не масив) — invalid-slots-shape', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/bad-shape', {
        rawPackageJson: JSON.stringify({
          name: '@x/bad-shape',
          'n-rules': { requiresPluginApi: 2, contributes: { rules: false }, slots: { provides: 'nope' } }
        })
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/bad-shape'] }, { allowInstall: false, quiet: true })
      expect(graph.diagnostics[0].code).toBe('invalid-slots-shape')
    })
  })
})

describe('getSlotContributions / getSlotConsumers', () => {
  test('фільтр за slot і supportedVersions', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/multi', {
        provides: [
          { slot: 'demo.widget', version: 1, id: 'a', value: 1 },
          { slot: 'demo.widget', version: 2, id: 'b', value: 2 },
          { slot: 'other.thing', version: 1, id: 'c', value: 3 }
        ]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/multi'] }, { allowInstall: false, quiet: true })
      expect(getSlotContributions(graph, 'demo.widget', [1]).map(c => c.id)).toEqual(['a'])
      expect(getSlotContributions(graph, 'demo.widget', [1, 2]).map(c => c.id)).toEqual(['a', 'b'])
      expect(getSlotContributions(graph, 'other.thing', [1]).map(c => c.id)).toEqual(['c'])
      expect(getSlotContributions(graph, 'unknown.slot', [1])).toEqual([])
    })
  })

  test('getSlotConsumers фільтрує за slot', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/two-consumers', {
        consumes: [
          { slot: 'demo.widget', versions: [1], handler: './h1.mjs' },
          { slot: 'other.thing', versions: [1], handler: './h2.mjs' }
        ]
      })
      await writeResource(packageRoot, './h1.mjs', 'export default {}')
      await writeResource(packageRoot, './h2.mjs', 'export default {}')
      const graph = resolveSlotGraph(dir, { plugins: ['@x/two-consumers'] }, { allowInstall: false, quiet: true })
      expect(getSlotConsumers(graph, 'demo.widget')).toHaveLength(1)
      expect(getSlotConsumers(graph, 'other.thing')).toHaveLength(1)
      expect(getSlotConsumers(graph, 'nope')).toEqual([])
    })
  })
})

describe('loadSlotConsumer — ЄДИНЕ місце динамічного import (§3.4)', () => {
  test('discovery (resolveSlotGraph) НЕ імпортує consumer-handler — модуль із side-effect не виконується', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/side-effect', {
        consumes: [{ slot: 'demo.widget', versions: [1], handler: './handler.mjs' }]
      })
      // Якби discovery імпортував handler, цей throw провалив би сам виклик resolveSlotGraph.
      await writeResource(
        packageRoot,
        './handler.mjs',
        'throw new Error("handler був імпортований під час discovery!")'
      )

      const graph = resolveSlotGraph(dir, { plugins: ['@x/side-effect'] }, { allowInstall: false, quiet: true })
      expect(graph.consumers).toHaveLength(1)

      // А ось явний виклик loadSlotConsumer МАЄ пропагувати цю саму помилку — доказ, що
      // import справді відбувається лише тут.
      await expect(loadSlotConsumer(graph.consumers[0])).rejects.toThrow('handler був імпортований під час discovery!')
    })
  })

  test('валідний consumer-handler — default export повертається як є', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/good-consumer', {
        consumes: [{ slot: 'demo.widget', versions: [1], handler: './handler.mjs' }]
      })
      await writeResource(packageRoot, './handler.mjs', 'export default { id: "good", validate: c => c.value > 0 }')
      const graph = resolveSlotGraph(dir, { plugins: ['@x/good-consumer'] }, { allowInstall: false, quiet: true })
      const loaded = await loadSlotConsumer(graph.consumers[0])
      expect(loaded.id).toBe('good')
      expect(typeof loaded.validate).toBe('function')
      expect(loaded.validate({ value: 1 })).toBe(true)
    })
  })

  test('default export не обʼєкт — TypeError', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/bad-export', {
        consumes: [{ slot: 'demo.widget', versions: [1], handler: './handler.mjs' }]
      })
      await writeResource(packageRoot, './handler.mjs', 'export default 42')
      const graph = resolveSlotGraph(dir, { plugins: ['@x/bad-export'] }, { allowInstall: false, quiet: true })
      await expect(loadSlotConsumer(graph.consumers[0])).rejects.toThrow(TypeError)
    })
  })

  test('відсутній стабільний id — TypeError', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/no-id', {
        consumes: [{ slot: 'demo.widget', versions: [1], handler: './handler.mjs' }]
      })
      await writeResource(packageRoot, './handler.mjs', 'export default { validate: () => true }')
      const graph = resolveSlotGraph(dir, { plugins: ['@x/no-id'] }, { allowInstall: false, quiet: true })
      await expect(loadSlotConsumer(graph.consumers[0])).rejects.toThrow(MISSING_ID_RE)
    })
  })

  test('відсутня функція validate — TypeError', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/no-validate', {
        consumes: [{ slot: 'demo.widget', versions: [1], handler: './handler.mjs' }]
      })
      await writeResource(packageRoot, './handler.mjs', 'export default { id: "x" }')
      const graph = resolveSlotGraph(dir, { plugins: ['@x/no-validate'] }, { allowInstall: false, quiet: true })
      await expect(loadSlotConsumer(graph.consumers[0])).rejects.toThrow(MISSING_VALIDATE_RE)
    })
  })
})

describe('resolveRulesDirs — core consumer rules.directory@1 (Фаза 2, spec §5.1.1/§5.1.4)', () => {
  test('ядро завжди перше, далі rules.directory@1 contributions у порядку графа', async () => {
    await withTmpDir(async dir => {
      const packageRoot = await writeFakeSlotPlugin(dir, '@x/p', {
        capabilities: ['ci:azure'],
        provides: [{ slot: 'rules.directory', version: 1, id: 'p-rules', resource: './rules' }]
      })
      await writeResource(packageRoot, './rules', '')
      const dirs = resolveRulesDirs(dir, { plugins: ['@x/p'] }, '/bundled/rules', { allowInstall: false, quiet: true })
      expect(dirs.map(d => d.name)).toEqual(['@7n/rules', '@x/p'])
      expect(dirs[0]).toEqual({ name: '@7n/rules', rulesDir: '/bundled/rules', packageRoot: null })
      expect(dirs[1].rulesDir.endsWith(join('@x/p', 'rules'))).toBe(true)
    })
  })

  test('плагін без rules.directory contribution — не потрапляє у результат (лише ядро)', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/handlers-only', {
        provides: [{ slot: 'taze.provider', version: 1, id: 'taze-x', resource: './provider.mjs' }]
      })
      const dirs = resolveRulesDirs(dir, { plugins: ['@x/handlers-only'] }, '/bundled/rules', {
        allowInstall: false,
        quiet: true
      })
      expect(dirs.map(d => d.name)).toEqual(['@7n/rules'])
    })
  })
})

describe('getActiveCapabilities — spec §5.1.11', () => {
  test('агрегує capabilities з усіх наявних плагінів', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/a', { capabilities: ['ci:github', 'x:y'] })
      await writeFakeSlotPlugin(dir, '@x/b', { capabilities: ['ci:azure'] })
      const caps = getActiveCapabilities(dir, { plugins: ['@x/a', '@x/b'] }, { allowInstall: false, quiet: true })
      expect([...caps].toSorted()).toEqual(['ci:azure', 'ci:github', 'x:y'])
    })
  })
})

describe('resolveSlotGraph — value-based contribution (без resource)', () => {
  test('inline value-contribution проходить без будь-якого filesystem I/O на resource', async () => {
    await withTmpDir(async dir => {
      await writeFakeSlotPlugin(dir, '@x/inline', {
        provides: [{ slot: 'doc-files.extensions', version: 1, id: 'ext', value: { '.rs': 'Rust Module' } }]
      })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/inline'] }, { allowInstall: false, quiet: true })
      expect(graph.contributions).toHaveLength(1)
      expect(graph.contributions[0].resourcePath).toBeNull()
      expect(graph.contributions[0].value).toEqual({ '.rs': 'Rust Module' })
      expect(graph.diagnostics).toEqual([])
    })
  })
})
