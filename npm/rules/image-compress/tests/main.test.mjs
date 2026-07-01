import { describe, expect, test } from 'vitest'
import { chmod, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { env } from 'node:process'

import { lint } from '../check/main.mjs'
import { ensureDir, withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'image-compress', concernId: 'check', files: undefined }).violations

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
  test('0 violations якщо --json не має needsCompression', async () => {
    await withTmpDir(async dir => {
      await withFakeNpx(
        dir,
        String.raw`printf '{"summary":{"needsCompression":0,"processed":1,"total":1,"unsupported":0},"files":[]}\n'`,
        () => {
          expect(run(dir)).toEqual([])
        }
      )
    })
  })

  test('violation якщо --json має needsCompression', async () => {
    await withTmpDir(async dir => {
      await withFakeNpx(
        dir,
        String.raw`printf '{"summary":{"needsCompression":2,"processed":1,"total":3,"unsupported":0},"files":[]}\n'`,
        () => {
          const violations = run(dir)
          expect(violations.length).toBeGreaterThan(0)
          expect(violations.some(v => v.reason === 'needs-compression')).toBe(true)
        }
      )
    })
  })
})
