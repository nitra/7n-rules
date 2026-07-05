/**
 * Тести T0-фіксера `fix-licensee.mjs`: предикат + інтеграційний прогін `licensee --init`.
 */
import { describe, expect, test } from 'vitest'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { patterns } from '../fix-licensee.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const P = patterns[0]

const exists = async p => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('bun-licensee-config-init pattern', () => {
  test('test: true лише на licensee-config-missing', () => {
    expect(P.test([{ reason: 'licensee-config-missing', message: 'm' }])).toBe(true)
    expect(P.test([{ reason: 'license-violation', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })

  test('apply: генерує .licensee.json через licensee --init', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', version: '0.0.0' })
      await writeFile(join(dir, 'bun.lock'), '{}\n', 'utf8')

      const res = await P.apply([{ reason: 'licensee-config-missing', message: 'm' }], { cwd: dir })

      expect(res.touchedFiles).toHaveLength(1)
      expect(await exists(join(dir, '.licensee.json'))).toBe(true)
    })
  }, 30000)
})
