/**
 * Тести T0-фіксера `fix-licensee.mjs`: три патерни — `licensee --init` +
 * канонічна нормалізація SPDX-allowlist, нормалізація вже наявного `.licensee.json`,
 * і безпечне проставлення `license: "ISC"` підтвердженим власним workspace-пакетам.
 */
import { describe, expect, test } from 'vitest'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { patterns } from '../fix-licensee.mjs'
import { withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

const [initPattern, canonicalPolicyPattern, workspaceMetadataPattern] = patterns

const CANONICAL_SPDX = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'BlueOak-1.0.0', '0BSD']

const exists = async p => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const readJson = async p => JSON.parse(await readFile(p, 'utf8'))

describe('bun-licensee-config-init pattern', () => {
  test('test: true лише на licensee-config-missing', () => {
    expect(initPattern.test([{ reason: 'licensee-config-missing', message: 'm' }])).toBe(true)
    expect(initPattern.test([{ reason: 'license-violation', message: 'm' }])).toBe(false)
    expect(initPattern.test([])).toBe(false)
  })

  test('apply: генерує .licensee.json через licensee --init з усіма 7 канонічними SPDX', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', version: '0.0.0' })
      await writeFile(join(dir, 'bun.lock'), '{}\n', 'utf8')

      const res = await initPattern.apply([{ reason: 'licensee-config-missing', message: 'm' }], { cwd: dir })

      expect(res.touchedFiles).toHaveLength(1)
      const configPath = join(dir, '.licensee.json')
      expect(await exists(configPath)).toBe(true)
      const config = await readJson(configPath)
      expect(config.licenses.spdx).toEqual(expect.arrayContaining(CANONICAL_SPDX))
      expect(new Set(config.licenses.spdx).size).toBe(CANONICAL_SPDX.length)
    })
  }, 30000)
})

describe('bun-licensee-canonical-policy pattern', () => {
  test('test: true лише на license-violation', () => {
    expect(canonicalPolicyPattern.test([{ reason: 'license-violation', message: 'm' }])).toBe(true)
    expect(canonicalPolicyPattern.test([{ reason: 'license-metadata-invalid', message: 'm' }])).toBe(false)
    expect(canonicalPolicyPattern.test([])).toBe(false)
  })

  test('apply: додає відсутні канонічні SPDX, зберігаючи packages/corrections/користувацькі spdx', async () => {
    await withTmpDir(async dir => {
      const configPath = join(dir, '.licensee.json')
      await writeJson(configPath, {
        licenses: { spdx: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0'] },
        packages: { 'legacy-pkg': '<=1.0.0' },
        corrections: true
      })

      const res = await canonicalPolicyPattern.apply([{ reason: 'license-violation', message: 'm' }], { cwd: dir })

      expect(res.touchedFiles).toEqual([configPath])
      const config = await readJson(configPath)
      expect(config.licenses.spdx).toEqual(
        expect.arrayContaining(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', ...CANONICAL_SPDX])
      )
      expect(config.packages).toEqual({ 'legacy-pkg': '<=1.0.0' })
      expect(config.corrections).toBe(true)
    })
  })

  test('apply: ідемпотентно — вже канонічний файл лишається без змін', async () => {
    await withTmpDir(async dir => {
      const configPath = join(dir, '.licensee.json')
      await writeJson(configPath, { licenses: { spdx: CANONICAL_SPDX }, packages: {}, corrections: false })

      const res = await canonicalPolicyPattern.apply([{ reason: 'license-violation', message: 'm' }], { cwd: dir })

      expect(res.touchedFiles).toEqual([])
    })
  })

  test('apply: без .licensee.json — no-op', async () => {
    await withTmpDir(async dir => {
      const res = await canonicalPolicyPattern.apply([{ reason: 'license-violation', message: 'm' }], { cwd: dir })
      expect(res.touchedFiles).toEqual([])
    })
  })
})

describe('bun-licensee-workspace-license-metadata pattern', () => {
  test('test: true лише на license-metadata-invalid з data.package', () => {
    expect(
      workspaceMetadataPattern.test([{ reason: 'license-metadata-invalid', message: 'm', data: { package: 'foo' } }])
    ).toBe(true)
    expect(workspaceMetadataPattern.test([{ reason: 'license-metadata-invalid', message: 'm' }])).toBe(false)
    expect(workspaceMetadataPattern.test([{ reason: 'license-violation', message: 'm' }])).toBe(false)
    expect(workspaceMetadataPattern.test([])).toBe(false)
  })

  test('apply: додає license лише підтвердженим workspace-пакетам без license, не чіпає решту', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'root-pkg',
        version: '0.0.0',
        workspaces: ['packages/*']
      })

      await mkdir(join(dir, 'packages/foo'), { recursive: true })
      await writeJson(join(dir, 'packages/foo/package.json'), { name: 'foo', version: '0.0.0' })

      await mkdir(join(dir, 'packages/bar'), { recursive: true })
      await writeJson(join(dir, 'packages/bar/package.json'), { name: 'bar', version: '0.0.0', license: 'MIT' })

      await mkdir(join(dir, 'packages/baz'), { recursive: true })
      await writeJson(join(dir, 'packages/baz/package.json'), { name: 'baz', version: '0.0.0' })

      // Стороннє ім'я, що ЗБІГАЄТЬСЯ з підтвердженим — але лежить у node_modules,
      // не workspace-member; resolveAllJsRoots його не enumerate-ить, тому лишається як є.
      await mkdir(join(dir, 'node_modules/foo'), { recursive: true })
      await writeJson(join(dir, 'node_modules/foo/package.json'), { name: 'foo', version: '9.9.9' })

      const violations = [
        { reason: 'license-metadata-invalid', message: 'm', data: { package: 'root-pkg' } },
        { reason: 'license-metadata-invalid', message: 'm', data: { package: 'foo' } }
      ]
      const res = await workspaceMetadataPattern.apply(violations, { cwd: dir })

      expect(res.touchedFiles).toHaveLength(2)
      expect(await readJson(join(dir, 'package.json'))).toMatchObject({ license: 'ISC' })
      expect(await readJson(join(dir, 'packages/foo/package.json'))).toMatchObject({ license: 'ISC' })
      // не підтверджений звітом — без змін
      expect(await readJson(join(dir, 'packages/baz/package.json'))).not.toHaveProperty('license')
      // вже має license — без змін
      expect(await readJson(join(dir, 'packages/bar/package.json'))).toMatchObject({ license: 'MIT' })
      // node_modules — не workspace-member, не чіпаємо
      expect(await readJson(join(dir, 'node_modules/foo/package.json'))).not.toHaveProperty('license')
    })
  })

  test('apply: жодного підтвердженого пакета в проєкті — no-op', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root-pkg', version: '0.0.0' })
      const res = await workspaceMetadataPattern.apply(
        [{ reason: 'license-metadata-invalid', message: 'm', data: { package: 'unrelated' } }],
        { cwd: dir }
      )
      expect(res.touchedFiles).toEqual([])
    })
  })
})
