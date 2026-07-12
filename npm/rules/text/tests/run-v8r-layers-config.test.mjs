/**
 * Тести схеми `layers-config.json` (каталог схем v8r, запис `layers-config`) — конфіг рушія
 * шарової документації `@7n/layers` (`<docsDir>/layers.json`, напр. `npm/docs/layers.json` у репо
 * `nitra/mt`). Перевіряє реальним v8r-прогоном через каталог `@nitra/cursor`, що валідний конфіг
 * проходить, а конфіг із порушенням схеми падає.
 *
 * v8r матчить `fileMatch` через `ignore`-стиль патерни відносно `process.cwd()` і відхиляє шляхи
 * поза деревом cwd (`path should be a path.relative()d string`) — тому фікстура створюється у
 * tmp-теці ВСЕРЕДИНІ кореня репо (не `os.tmpdir()`, як типовий `withTmpDir`), із гарантованим
 * прибиранням у `finally`.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { runV8rWithFiles } from '../run-v8r/main.mjs'

const VALID_LAYERS_CONFIG = {
  version: 1,
  tier: 'min',
  maxTokens: 4096,
  i18n: { baseLang: 'uk', langs: ['en'] },
  docs: {
    'overview/index.md': { layer: 'L1', title: 'Як це працює', sources: ['direction.md'] },
    'index.md': { layer: 'L0', mode: 'fragment', sources: ['overview/index.md'] }
  }
}

const createdDirs = []

/**
 * Створює tmp-каталог із `docs/layers.json` усередині кореня репо (не `os.tmpdir()` — v8r
 * відхиляє шляхи поза деревом cwd) і повертає relative-до-cwd шлях до файлу.
 * @param {unknown} content вміст, що серіалізується в JSON
 * @returns {Promise<string>} шлях до фікстури, relative до `process.cwd()`
 */
async function writeLayersFixture(content) {
  const dir = await mkdtemp(join(process.cwd(), '.tmp-layers-config-test-'))
  createdDirs.push(dir)
  await mkdir(join(dir, 'docs'), { recursive: true })
  const file = join(dir, 'docs', 'layers.json')
  await writeFile(file, JSON.stringify(content, null, 2), 'utf8')
  return relative(process.cwd(), file)
}

describe('layers-config.json schema (v8r-catalog)', () => {
  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  test('валідний docs/layers.json проходить v8r без помилок', async () => {
    const file = await writeLayersFixture(VALID_LAYERS_CONFIG)
    expect(runV8rWithFiles([file])).toBe(0)
  })

  test('docs/layers.json з невідомою властивістю падає (additionalProperties: false)', async () => {
    const file = await writeLayersFixture({ ...VALID_LAYERS_CONFIG, unknownField: true })
    expect(runV8rWithFiles([file])).not.toBe(0)
  })

  test('docs/layers.json без required "docs" падає', async () => {
    const file = await writeLayersFixture({ version: 1 })
    expect(runV8rWithFiles([file])).not.toBe(0)
  })
})
