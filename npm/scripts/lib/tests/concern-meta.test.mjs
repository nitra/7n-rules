import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readConcernMeta, listConcerns } from '../concern-meta.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

/**
 * Записує concern.json у `<dir>/<rule>/<concern>/` і повертає шлях до concern-теки.
 * @param {string} dir корінь тимчасового каталогу тесту
 * @param {string} rule id правила
 * @param {string} concern id concern-а
 * @param {object} json вміст concern.json
 * @returns {Promise<string>} шлях до створеної concern-теки
 */
async function seedConcern(dir, rule, concern, json) {
  const concernDir = join(dir, rule, concern)
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), json)
  return concernDir
}

describe('concern-meta — policy.engine derivation', () => {
  test('явний engine:"rego"', async () => {
    await withTmpDir(async dir => {
      const c = await seedConcern(dir, 'k8s', 'manifest', {
        policy: { engine: 'rego', files: { walkGlob: 'k8s/**/*.yaml' } }
      })
      const m = await readConcernMeta(c, 'manifest')
      expect(m.policy.engine).toBe('rego')
      expect(m.policy.check).toBeUndefined()
    })
  })

  test('явний engine:"template"', async () => {
    await withTmpDir(async dir => {
      const c = await seedConcern(dir, 'worktree', 'vscode_settings', {
        policy: { engine: 'template', files: { single: '.vscode/settings.json' } }
      })
      const m = await readConcernMeta(c, 'vscode_settings')
      expect(m.policy.engine).toBe('template')
    })
  })

  test('legacy check:"template" → engine:"template"', async () => {
    await withTmpDir(async dir => {
      const c = await seedConcern(dir, 'worktree', 'zed_settings', {
        policy: { check: 'template', files: { single: '.zed/settings.json' } }
      })
      const m = await readConcernMeta(c, 'zed_settings')
      expect(m.policy.engine).toBe('template')
      expect(m.policy.check).toBe('template') // legacy лишається для backward-compat
    })
  })

  test('legacy без engine/check (Rego) → engine:"rego"', async () => {
    await withTmpDir(async dir => {
      const c = await seedConcern(dir, 'abie', 'http_route_base', {
        policy: { files: { walkGlob: 'k8s/**/base/**/*.yaml' } }
      })
      const m = await readConcernMeta(c, 'http_route_base')
      expect(m.policy.engine).toBe('rego')
    })
  })
})

describe('concern-meta — lint surface', () => {
  test('lint scope/glob нормалізується (string → array)', async () => {
    await withTmpDir(async dir => {
      const c = await seedConcern(dir, 'js', 'eslint', {
        lint: { scope: 'per-file', glob: '**/*.mjs' }
      })
      const m = await readConcernMeta(c, 'eslint')
      expect(m.lint.scope).toBe('per-file')
      expect(m.lint.glob).toEqual(['**/*.mjs'])
    })
  })

  test('listConcerns ігнорує теки без concern.json', async () => {
    await withTmpDir(async dir => {
      await seedConcern(dir, 'rule', 'real', { lint: { scope: 'full' } })
      await mkdir(join(dir, 'rule', 'utils'), { recursive: true })
      await writeFile(join(dir, 'rule', 'utils', 'helper.mjs'), 'export const x = 1\n', 'utf8')
      const concerns = await listConcerns(join(dir, 'rule'))
      expect(concerns.map(c => c.name)).toEqual(['real'])
    })
  })
})
