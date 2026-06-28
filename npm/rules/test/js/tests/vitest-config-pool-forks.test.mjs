/**
 * Тести правила test.mdc (concern vitest-config-pool-forks).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main } from '../vitest-config-pool-forks.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('check test.vitest-config-pool-forks', () => {
  test("успіх: config з pool: 'forks' → exit 0", async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'vitest.config.js'),
        `import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { pool: 'forks' } })
`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("успіх: vitest.config.mjs з pool: 'forks' → exit 0", async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.mjs'), "export default { test: { pool: 'forks' } }\n")
      expect(await check(dir)).toBe(0)
    })
  })

  test("порушення: vitest.config.mjs з pool: 'threads' → exit 1", async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.mjs'), "export default { test: { pool: 'threads' } }\n")
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: pool: "forks" з подвійними кавичками → exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.js'), 'export default { test: { pool: "forks" } }\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test("порушення: pool: 'threads' → exit 1", async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.js'), "export default { test: { pool: 'threads' } }\n")
      expect(await check(dir)).toBe(1)
    })
  })

  test('порушення: config без поля pool → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.js'), 'export default { test: {} }\n')
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: vitest.config.{mjs,js} відсутній → skip → exit 0', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: pool: "forks" з whitespace навколо двокрапки → exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.js'), 'export default { test: { pool : "forks" } }\n')
      expect(await check(dir)).toBe(0)
    })
  })
})
