import { describe, expect, test } from 'vitest'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { env } from 'node:process'

import { lint } from '../../main.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * Запускає тест із fake `npx`, який повертає заданий shell-body.
 * @param {string} dir tmp-корінь
 * @param {string} body shell body після shebang
 * @param {() => Promise<void>} fn тестовий callback
 * @returns {Promise<void>}
 */
async function withFakeNpx(dir, body, fn) {
  const binDir = join(dir, 'bin')
  await ensureDir(binDir)
  const npx = join(binDir, 'npx')
  await writeFile(npx, `#!/bin/sh\n${body}\n`, 'utf8')
  await chmod(npx, 0o755)
  const prevPath = env.PATH
  env.PATH = `${binDir}${delimiter}${prevPath ?? ''}`
  try {
    await fn()
  } finally {
    if (prevPath === undefined) delete env.PATH
    else env.PATH = prevPath
  }
}

describe('image-compress lint adapter', () => {
  test('readOnly: 0 якщо --json не має needsCompression', async () => {
    await withTmpDir(async dir => {
      await withFakeNpx(
        dir,
        String.raw`printf '{"summary":{"needsCompression":0,"processed":1,"total":1,"unsupported":0},"files":[]}\n'`,
        async () => {
          expect(await lint(undefined, dir, { readOnly: true })).toBe(0)
        }
      )
    })
  })

  test('readOnly: 1 якщо --json має needsCompression', async () => {
    await withTmpDir(async dir => {
      await withFakeNpx(
        dir,
        String.raw`printf '{"summary":{"needsCompression":2,"processed":1,"total":3,"unsupported":0},"files":[]}\n'`,
        async () => {
          expect(await lint(undefined, dir, { readOnly: true })).toBe(1)
        }
      )
    })
  })

  test('fix: запускає @nitra/minify-image --write', async () => {
    await withTmpDir(async dir => {
      const argsFile = join(dir, 'args.txt')
      await withFakeNpx(dir, `printf '%s\\n' "$@" > "${argsFile}"`, async () => {
        expect(await lint(undefined, dir)).toBe(0)
      })
      expect(await readFile(argsFile, 'utf8')).toBe('@nitra/minify-image\n--src=.\n--write\n')
    })
  })
})
