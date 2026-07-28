import { describe, expect, test } from 'vitest'
import { chmod, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { env } from 'node:process'

import { lint } from '../check/main.mjs'
import { ensureDir, withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

const run = async dir => {
  const result = await lint({ cwd: dir, ruleId: 'image-compress', concernId: 'check', files: undefined })
  return result.violations
}

/**
 * Запускає тест із fake `bunx`, який повертає заданий shell-body.
 * @param {string} dir tmp-корінь
 * @param {string} body shell body після shebang
 * @param {() => Promise<void>} fn тестовий callback
 * @returns {Promise<void>}
 */
async function withFakeBunx(dir, body, fn) {
  const binDir = join(dir, 'bin')
  await ensureDir(binDir)
  const bunx = join(binDir, 'bunx')
  await writeFile(bunx, `#!/bin/sh\n${body}\n`, 'utf8')
  await chmod(bunx, 0o755)
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
      await withFakeBunx(
        dir,
        String.raw`printf '{"summary":{"needsCompression":0,"processed":1,"total":1,"unsupported":0},"files":[]}\n'`,
        async () => {
          expect(await run(dir)).toEqual([])
        }
      )
    })
  })

  test('violation якщо --json має needsCompression', async () => {
    await withTmpDir(async dir => {
      await withFakeBunx(
        dir,
        String.raw`printf '{"summary":{"needsCompression":2,"processed":1,"total":3,"unsupported":0},"files":[]}\n'`,
        async () => {
          const violations = await run(dir)
          expect(violations.length).toBeGreaterThan(0)
          expect(violations.some(v => v.reason === 'needs-compression')).toBe(true)
        }
      )
    })
  })

  test('0 violations + info-діагностика якщо bunx відсутній у PATH', async () => {
    await withTmpDir(async dir => {
      const prevPath = env.PATH
      env.PATH = ''
      try {
        const result = await lint({ cwd: dir, ruleId: 'image-compress', concernId: 'check', files: undefined })
        expect(result.violations).toEqual([])
        expect(result.diagnostics?.some(d => d.level === 'info' && d.message.includes('bunx'))).toBe(true)
      } finally {
        if (prevPath === undefined) delete env.PATH
        else env.PATH = prevPath
      }
    })
  })
})
