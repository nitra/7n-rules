import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { clearSlotResolveCache } from '../../../../scripts/lib/plugin-slots.mjs'
import { clearPluginResolveCache } from '../../../../scripts/lib/resolve-plugins.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { loadKnowledgeAdapters } from '../load-adapters.mjs'
import { discoverDomainCodeExtensions } from '../source-loader.mjs'

afterEach(() => {
  clearSlotResolveCache()
  clearPluginResolveCache()
})

/**
 * Встановлює один фейковий plugin-slot package та повертає його корінь.
 * @param {string} repoRoot tmp repo
 * @param {string} name npm-імʼя plugin-а
 * @param {object[]} provides knowledge contributions
 * @returns {Promise<string>} корінь пакета
 */
async function writePlugin(repoRoot, name, provides) {
  const packageRoot = join(repoRoot, 'node_modules', name)
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      'n-rules': { requiresPluginApi: 2, contributes: { rules: false }, slots: { provides } }
    })
  )
  return packageRoot
}

/**
 * Пише ESM resource plugin-а за package-relative шляхом.
 * @param {string} packageRoot корінь plugin-а
 * @param {string} relPath шлях із ./
 * @param {string} source ESM source
 * @returns {Promise<void>}
 */
async function writeResource(packageRoot, relPath, source) {
  const path = join(packageRoot, relPath.slice(2))
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, source)
}

/**
 * Створює мінімальний valid knowledge plugin із обома adapter-ами.
 * @param {string} repoRoot tmp repo
 * @param {string} [name] npm-імʼя
 * @param {{ domain?: string, extractor?: string, domainId?: string, extractorId?: string }} [sources] adapter sources
 * @returns {Promise<void>}
 */
async function installKnowledgePlugin(repoRoot, name = '@x/knowledge', sources = {}) {
  const domainId = sources.domainId ?? 'domain-js'
  const extractorId = sources.extractorId ?? 'extractor-js'
  const packageRoot = await writePlugin(repoRoot, name, [
    { slot: 'knowledge.domain', version: 1, id: domainId, resource: './domain.mjs' },
    { slot: 'knowledge.extractor', version: 1, id: extractorId, resource: './extractor.mjs' }
  ])
  await writeResource(
    packageRoot,
    './domain.mjs',
    sources.domain ??
      `export default { id: '${domainId}', apiVersion: 1, ecosystem: 'js', findDomains: () => [], resolveDomain: path => ({ path }) }\n`
  )
  await writeResource(
    packageRoot,
    './extractor.mjs',
    sources.extractor ??
      `export default { id: '${extractorId}', apiVersion: 1, extensions: ['.js'], parser: { id: 'oxc', grammarVersion: '1', runtimeVersion: '1' }, analyzeFile: input => input }\n`
  )
  await writeFile(join(repoRoot, '.n-rules.json'), JSON.stringify({ plugins: [name] }))
}

describe('loadKnowledgeAdapters', () => {
  test('реєструє обидва versioned slots у manifest-порядку без нового plugin mechanism', async () => {
    await withTmpDir(async repoRoot => {
      await installKnowledgePlugin(repoRoot)
      const result = await loadKnowledgeAdapters({
        repoRoot,
        domainRoot: repoRoot,
        config: { plugins: ['@x/knowledge'] },
        requiredExtensions: ['.js']
      })
      expect(result).toMatchObject({ blocked: false, diagnostics: [] })
      expect(result.adapters?.domain.map(adapter => adapter.id)).toEqual(['domain-js'])
      expect(result.adapters?.extractor.map(adapter => adapter.id)).toEqual(['extractor-js'])
      expect(result.adapters?.extractor[0].extensions).toEqual(['.js'])
    })
  })

  test('preserves optional full-parser test collector on knowledge extractor adapter', async () => {
    await withTmpDir(async repoRoot => {
      await installKnowledgePlugin(repoRoot, '@x/test-collector', {
        extractor: "export default { id: 'extractor-js', apiVersion: 1, extensions: ['.js'], parser: { id: 'oxc', grammarVersion: '1', runtimeVersion: '1' }, analyzeFile: input => input, collectTestScenarios: () => ({ ok: true, scenarios: [] }) }\n"
      })
      const result = await loadKnowledgeAdapters({ repoRoot, domainRoot: repoRoot, config: { plugins: ['@x/test-collector'] } })
      expect(result.adapters.extractor[0].collectTestScenarios({ file: { path: 'x.js', content: '' } })).toEqual({ ok: true, scenarios: [] })
    })
  })

  test('зберігає детермінований порядок plugins для domain і extractor adapter-ів', async () => {
    await withTmpDir(async repoRoot => {
      await installKnowledgePlugin(repoRoot, '@x/first')
      await installKnowledgePlugin(repoRoot, '@x/second', {
        domainId: 'domain-ts',
        extractorId: 'extractor-ts',
        extractor:
          "export default { id: 'extractor-ts', apiVersion: 1, extensions: ['.ts'], parser: { id: 'oxc', grammarVersion: '1', runtimeVersion: '1' }, analyzeFile: input => input }\n"
      })
      const result = await loadKnowledgeAdapters({
        repoRoot,
        domainRoot: repoRoot,
        config: { plugins: ['@x/first', '@x/second'] },
        requiredExtensions: ['.js', '.ts']
      })
      expect(result).toMatchObject({ blocked: false, diagnostics: [] })
      expect(result.adapters?.domain.map(adapter => adapter.id)).toEqual(['domain-js', 'domain-ts'])
      expect(result.adapters?.extractor.map(adapter => adapter.id)).toEqual(['extractor-js', 'extractor-ts'])
    })
  })

  test('вимагає явні абсолютні repoRoot і domainRoot, не використовує cwd', async () => {
    await withTmpDir(async repoRoot => {
      const result = await loadKnowledgeAdapters({ repoRoot: '.', domainRoot: repoRoot })
      expect(result).toMatchObject({ blocked: true, adapters: null })
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'invalid-root', blocking: true })])
    })
  })

  test('блокує domainRoot поза межами repoRoot', async () => {
    await withTmpDir(async repoRoot => {
      await withTmpDir(async outside => {
        const result = await loadKnowledgeAdapters({ repoRoot, domainRoot: outside })
        expect(result).toMatchObject({ blocked: true, adapters: null })
        expect(result.diagnostics).toEqual([
          expect.objectContaining({ code: 'domain-outside-repository', blocking: true })
        ])
      })
    })
  })

  test('zero domain providers допустимі, доки built-in resolver не потребує language adapter-а', async () => {
    await withTmpDir(async repoRoot => {
      const result = await loadKnowledgeAdapters({ repoRoot, domainRoot: repoRoot, config: { plugins: [] } })
      expect(result).toMatchObject({ blocked: false, diagnostics: [] })
      expect(result.adapters).toMatchObject({ domain: [], extractor: [] })
    })
  })

  test('відсутній extractor для required extension блокує publication без fallback', async () => {
    await withTmpDir(async repoRoot => {
      const result = await loadKnowledgeAdapters({
        repoRoot,
        domainRoot: repoRoot,
        config: { plugins: [] },
        requiredExtensions: ['.js']
      })
      expect(result).toMatchObject({ blocked: true, adapters: null })
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'missing-extractor-extension', slot: 'knowledge.extractor', blocking: true })
      ])
    })
  })

  test('blocks a discovered language whose extractor plugin is not installed', async () => {
    await withTmpDir(async repoRoot => {
      await mkdir(join(repoRoot, 'src'), { recursive: true })
      await writeFile(join(repoRoot, 'src', 'orders.ts'), 'export const orders = []\n')
      const inventory = await discoverDomainCodeExtensions({
        domain: { id: 'npm:@fixture/root', root: repoRoot, sourceRoot: '.', excludedSourceRoots: [] }
      })
      const result = await loadKnowledgeAdapters({
        repoRoot,
        domainRoot: repoRoot,
        config: { plugins: [] },
        requiredExtensions: inventory.extensions
      })

      expect(inventory).toEqual({ ok: true, extensions: ['.ts'] })
      expect(result).toMatchObject({ blocked: true, adapters: null })
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'missing-extractor-extension', slot: 'knowledge.extractor', blocking: true })
      ])
    })
  })

  test('битий ESM resource повертає structured blocking diagnostic', async () => {
    await withTmpDir(async repoRoot => {
      await installKnowledgePlugin(repoRoot, '@x/broken', { extractor: `throw new Error('broken extractor')\n` })
      const result = await loadKnowledgeAdapters({ repoRoot, domainRoot: repoRoot, config: { plugins: ['@x/broken'] } })
      expect(result).toMatchObject({ blocked: true, adapters: null })
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'adapter-import-failed',
          slot: 'knowledge.extractor',
          plugin: '@x/broken',
          blocking: true
        })
      ])
    })
  })

  test('malformed adapter не замінюється whole-file fallback-ом', async () => {
    await withTmpDir(async repoRoot => {
      await installKnowledgePlugin(repoRoot, '@x/malformed', {
        extractor: `export default { id: 'extractor-js', apiVersion: 1, extensions: ['.js'] }\n`
      })
      const result = await loadKnowledgeAdapters({
        repoRoot,
        domainRoot: repoRoot,
        config: { plugins: ['@x/malformed'] }
      })
      expect(result).toMatchObject({ blocked: true, adapters: null })
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'malformed-adapter',
          slot: 'knowledge.extractor',
          plugin: '@x/malformed',
          blocking: true
        })
      ])
    })
  })

  test('collision extension є blocking замість залежного від order last-wins', async () => {
    await withTmpDir(async repoRoot => {
      await installKnowledgePlugin(repoRoot, '@x/first')
      await installKnowledgePlugin(repoRoot, '@x/second', { domainId: 'domain-ts', extractorId: 'extractor-ts' })
      const config = { plugins: ['@x/first', '@x/second'] }
      const result = await loadKnowledgeAdapters({ repoRoot, domainRoot: repoRoot, config })
      expect(result).toMatchObject({ blocked: true, adapters: null })
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'duplicate-extractor-extension',
          slot: 'knowledge.extractor',
          contributionId: 'extractor-ts'
        })
      ])
    })
  })
})
