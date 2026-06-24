/**
 * Тести правила js.mdc (concern dep-policy): сканер заборонених import-specifier'ів
 * (наразі — @nitra/as-integrations-fastify).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../dep-policy.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

// Ім'я забороненого пакета — через join щоб не тригерити потенційний future-sканер
// на самому цьому файлі (pattern аналогічний до no-console-store-restore).
const BANNED = ['@nitra/as-integrations', '-fastify'].join('')

describe('check js.dep-policy', () => {
  test('успіх: немає JS-файлів — exit 0', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: JS-файл без заборонених імпортів → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(
        join(dir, 'src/server.mjs'),
        'import fastifyApollo from "@as-integrations/fastify"\nexport default fastifyApollo\n'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test(`порушення: static import '${BANNED}' → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(
        join(dir, 'src/server.mjs'),
        `import fastifyApollo from '${BANNED}'\nexport default fastifyApollo\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test(`порушення: dynamic import('${BANNED}') → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/server.mjs'), `const m = await import('${BANNED}')\n`)
      expect(await check(dir)).toBe(1)
    })
  })

  test(`порушення: у .ts файлі → exit 1`, async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(
        join(dir, 'src/server.ts'),
        `import fastifyApollo, { fastifyApolloDrainPlugin } from '${BANNED}'\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: node_modules пропускається → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, `node_modules/${BANNED}`), { recursive: true })
      await writeFile(join(dir, `node_modules/${BANNED}/index.mjs`), `import x from '${BANNED}'\nexport default x\n`)
      expect(await check(dir)).toBe(0)
    })
  })

  test('кілька порушень у різних файлах — всі репортуються → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/a.mjs'), `import x from '${BANNED}'\n`)
      await writeFile(join(dir, 'src/b.ts'), `import y from '${BANNED}'\n`)
      expect(await check(dir)).toBe(1)
    })
  })
})
