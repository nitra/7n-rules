import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { withTmpDir, installFakeLangJsPlugin } from '../../../../scripts/utils/test-helpers.mjs'
import {
  pluginDocFilesExtensions,
  unavailableDocFilesPlugins,
  loadDocFilesExtractors,
  clearDocFilesLangCache
} from '../lang-extensions.mjs'

/**
 * Пише фейковий плагін з handler-модулем `doc-files` у node_modules tmp-репо
 * і декларує його в `.n-rules.json`.
 * @param {string} dir корінь tmp-репо
 * @param {string} handlerBody вміст handler-модуля (ESM default export)
 */
async function installFakeHandlerPlugin(dir, handlerBody) {
  const pkgRoot = join(dir, 'node_modules', '@x', 'lang-fake')
  await mkdir(pkgRoot, { recursive: true })
  await writeFile(
    join(pkgRoot, 'package.json'),
    JSON.stringify({
      name: '@x/lang-fake',
      version: '0.0.0',
      'n-rules': { contributes: { rules: false, handlers: { 'doc-files': './handler.mjs' } } }
    })
  )
  await writeFile(join(pkgRoot, 'handler.mjs'), handlerBody)
  await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ plugins: ['@x/lang-fake'] }))
}

describe('pluginDocFilesExtensions', () => {
  test('немає .n-rules.json і немає плагінів у node_modules — порожня мапа', async () => {
    await withTmpDir(dir => {
      expect(pluginDocFilesExtensions(dir)).toEqual({})
    })
  })

  test('встановлений і задекларований плагін — розширення в мапі', async () => {
    await withTmpDir(async dir => {
      await installFakeLangJsPlugin(dir)
      expect(pluginDocFilesExtensions(dir)).toMatchObject({ '.mjs': 'JS Module' })
    })
  })
})

describe('unavailableDocFilesPlugins', () => {
  test('плагін задекларований у .n-rules.json, але не встановлений — потрапляє у список', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ plugins: ['@7n/rules-lang-js'] }))
      expect(unavailableDocFilesPlugins(dir)).toEqual(['@7n/rules-lang-js'])
    })
  })

  test('плагін встановлений — мапа розширень непорожня, список недоступних порожній', async () => {
    await withTmpDir(async dir => {
      await installFakeLangJsPlugin(dir)
      expect(unavailableDocFilesPlugins(dir)).toEqual([])
    })
  })

  test('немає .n-rules.json взагалі — порожній список (нема що вважати недоступним)', async () => {
    await withTmpDir(dir => {
      expect(unavailableDocFilesPlugins(dir)).toEqual([])
    })
  })

  test('битий .n-rules.json (невалідний JSON) — трактується як конфіг без плагінів', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), '{ not valid json')
      expect(unavailableDocFilesPlugins(dir)).toEqual([])
    })
  })
})

describe('loadDocFilesExtractors', () => {
  test('плагін з handler-модулем doc-files — екстрактор доступний за розширенням', async () => {
    await withTmpDir(async dir => {
      await installFakeHandlerPlugin(
        dir,
        `export default { id: 'fake', extensions: ['.fake'], extractFacts: () => ({}) }\n`
      )
      const map = await loadDocFilesExtractors(dir)
      expect(map.get('.fake')?.id).toBe('fake')
    })
  })

  test('битий handler-модуль (кидає при імпорті) — мовчазний пропуск', async () => {
    await withTmpDir(async dir => {
      await installFakeHandlerPlugin(dir, `throw new Error('boom')\n`)
      const map = await loadDocFilesExtractors(dir)
      expect(map.size).toBe(0)
    })
  })
})

describe('clearDocFilesLangCache', () => {
  test('скидає кеш — наступний виклик перечитує змінений .n-rules.json', async () => {
    await withTmpDir(async dir => {
      expect(pluginDocFilesExtensions(dir)).toEqual({})
      await installFakeLangJsPlugin(dir)
      // Без скидання кешу пропозиція лишалась би порожньою (кеш keyed за dir).
      expect(pluginDocFilesExtensions(dir)).toEqual({})
      clearDocFilesLangCache()
      expect(pluginDocFilesExtensions(dir)).toMatchObject({ '.mjs': 'JS Module' })
    })
  })
})
