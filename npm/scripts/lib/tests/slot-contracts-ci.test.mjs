/**
 * Тести canonical payload-контракту `ci.artifact@1` (`slot-contracts-ci.mjs`, spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction, §7.1, §10 Фаза 3 п.4): валідні/невалідні
 * descriptors (невідомі поля, небезпечний template path, не-yaml format), containment-резолв
 * template-шляху й читання/парсинг payload-у contribution-у.
 */
import { describe, expect, test } from 'vitest'
import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  CI_ARTIFACT_ID_RE,
  isSafeRepoRelativePath,
  isSafeTemplateRelPath,
  loadCiArtifactPayload,
  resolveArtifactTemplatePath,
  validateCiArtifactPayload
} from '../slot-contracts-ci.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

/** Мінімальний валідний payload — базис для мутацій в негативних тестах. */
const VALID_PAYLOAD = Object.freeze({
  targetCapability: 'ci:github',
  artifactId: 'lint-demo',
  targetPath: '.github/workflows/lint-demo.yml',
  format: 'yaml',
  mode: 'required-file',
  template: './github/lint-demo.yml.snippet.yml',
  mergeStrategy: 'deep-subset',
  fix: true
})

describe('validateCiArtifactPayload — валідний payload', () => {
  test('повертає ok:true і заморожений descriptor', () => {
    const result = validateCiArtifactPayload(VALID_PAYLOAD)
    expect(result.ok).toBe(true)
    expect(result.descriptor).toEqual(VALID_PAYLOAD)
    expect(Object.isFrozen(result.descriptor)).toBe(true)
  })
})

describe('validateCiArtifactPayload — невідомі поля (v1 reject)', () => {
  test('додаткове поле payload → ok:false з переліком невідомих полів', () => {
    const result = validateCiArtifactPayload({ ...VALID_PAYLOAD, priority: 1 })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('priority')
  })
})

describe('validateCiArtifactPayload — небезпечний template path', () => {
  test('template без "./" префіксу → ok:false', () => {
    const result = validateCiArtifactPayload({ ...VALID_PAYLOAD, template: 'github/lint-demo.yml.snippet.yml' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('template')
  })

  test('template з ".." сегментом → ok:false', () => {
    const result = validateCiArtifactPayload({ ...VALID_PAYLOAD, template: '../escape.yml' })
    expect(result.ok).toBe(false)
  })

  test('абсолютний template path → ok:false', () => {
    const result = validateCiArtifactPayload({ ...VALID_PAYLOAD, template: '/etc/passwd' })
    expect(result.ok).toBe(false)
  })
})

describe('validateCiArtifactPayload — format', () => {
  test('format не "yaml" → ok:false (v1 підтримує лише yaml)', () => {
    const result = validateCiArtifactPayload({ ...VALID_PAYLOAD, format: 'json' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('format')
  })
})

describe('validateCiArtifactPayload — інші поля', () => {
  test('artifactId з великою літерою → ok:false', () => {
    expect(validateCiArtifactPayload({ ...VALID_PAYLOAD, artifactId: 'Lint-Demo' }).ok).toBe(false)
  })

  test('targetPath абсолютний → ok:false', () => {
    expect(validateCiArtifactPayload({ ...VALID_PAYLOAD, targetPath: '/etc/passwd' }).ok).toBe(false)
  })

  test('targetPath з ".." → ok:false', () => {
    expect(validateCiArtifactPayload({ ...VALID_PAYLOAD, targetPath: '../escape.yml' }).ok).toBe(false)
  })

  test('mode не з переліку → ok:false', () => {
    expect(validateCiArtifactPayload({ ...VALID_PAYLOAD, mode: 'delete' }).ok).toBe(false)
  })

  test('mergeStrategy не з переліку → ok:false', () => {
    expect(validateCiArtifactPayload({ ...VALID_PAYLOAD, mergeStrategy: 'overwrite' }).ok).toBe(false)
  })

  test('fix не boolean → ok:false', () => {
    expect(validateCiArtifactPayload({ ...VALID_PAYLOAD, fix: 'true' }).ok).toBe(false)
  })

  test('payload не обʼєкт → ok:false', () => {
    expect(validateCiArtifactPayload(null).ok).toBe(false)
    expect(validateCiArtifactPayload('nope').ok).toBe(false)
    expect(validateCiArtifactPayload([1, 2]).ok).toBe(false)
  })

  test('усі помилки акумулюються в одному виклику', () => {
    const result = validateCiArtifactPayload({ mode: 'delete' })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(3)
  })
})

describe('CI_ARTIFACT_ID_RE / isSafeRepoRelativePath / isSafeTemplateRelPath', () => {
  test('artifactId regex — той самий формат, що й contribution id', () => {
    expect(CI_ARTIFACT_ID_RE.test('lint-php')).toBe(true)
    expect(CI_ARTIFACT_ID_RE.test('LintPhp')).toBe(false)
    expect(CI_ARTIFACT_ID_RE.test('')).toBe(false)
  })

  test('isSafeRepoRelativePath', () => {
    expect(isSafeRepoRelativePath('.github/workflows/x.yml')).toBe(true)
    expect(isSafeRepoRelativePath('/abs')).toBe(false)
    expect(isSafeRepoRelativePath('a/../b')).toBe(false)
    expect(isSafeRepoRelativePath('')).toBe(false)
    expect(isSafeRepoRelativePath(42)).toBe(false)
  })

  test('isSafeTemplateRelPath', () => {
    expect(isSafeTemplateRelPath('./a/b.yml')).toBe(true)
    expect(isSafeTemplateRelPath('a/b.yml')).toBe(false)
    expect(isSafeTemplateRelPath('./a/../b.yml')).toBe(false)
  })
})

describe('resolveArtifactTemplatePath', () => {
  test('resource-based contribution: template резолвиться від каталогу дескриптора', async () => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'pkg')
      await mkdir(join(packageRoot, 'slots', 'ci', 'github'), { recursive: true })
      await writeFile(join(packageRoot, 'slots', 'ci', 'lint-demo.json'), '{}')
      await writeFile(join(packageRoot, 'slots', 'ci', 'github', 'lint-demo.yml.snippet.yml'), 'name: demo\n')

      const contribution = { packageRoot, resourcePath: join(packageRoot, 'slots', 'ci', 'lint-demo.json') }
      const descriptor = { ...VALID_PAYLOAD, template: './github/lint-demo.yml.snippet.yml' }
      const result = resolveArtifactTemplatePath(contribution, descriptor)
      expect(result.ok).toBe(true)
      expect(result.exists).toBe(true)
      // realpath (не голий join) — на macOS /tmp є symlink на /private/tmp.
      expect(result.absPath).toBe(realpathSync(join(packageRoot, 'slots', 'ci', 'github', 'lint-demo.yml.snippet.yml')))
    })
  })

  test('value-based contribution (resourcePath: null): template резолвиться від packageRoot', async () => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'pkg')
      await mkdir(join(packageRoot, 'tpl'), { recursive: true })
      await writeFile(join(packageRoot, 'tpl', 'x.yml'), 'name: x\n')

      const contribution = { packageRoot, resourcePath: null }
      const descriptor = { ...VALID_PAYLOAD, template: './tpl/x.yml' }
      const result = resolveArtifactTemplatePath(contribution, descriptor)
      expect(result.ok).toBe(true)
      expect(result.exists).toBe(true)
    })
  })

  test('template-шлях, що виходить за межі packageRoot — ok:false', async () => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'pkg')
      await mkdir(join(dir, 'outside'), { recursive: true })
      await writeFile(join(dir, 'outside', 'secret.yml'), 'x: 1\n')
      await mkdir(packageRoot, { recursive: true })

      // template-поле вже пройшло shape-валідацію (без ".." сегментів), але
      // resourcePath contribution-у сам може лежати поза packageRoot (маніфестна аномалія) —
      // containment все одно має заблокувати вихід.
      const contribution = { packageRoot, resourcePath: join(dir, 'outside', 'descriptor.json') }
      const descriptor = { ...VALID_PAYLOAD, template: './secret.yml' }
      const result = resolveArtifactTemplatePath(contribution, descriptor)
      expect(result.ok).toBe(false)
    })
  })

  test('template не існує — ok:true, exists:false (missing-template — рішення викликача)', async () => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'pkg')
      await mkdir(packageRoot, { recursive: true })
      const contribution = { packageRoot, resourcePath: null }
      const descriptor = { ...VALID_PAYLOAD, template: './nope.yml' }
      const result = resolveArtifactTemplatePath(contribution, descriptor)
      expect(result.ok).toBe(true)
      expect(result.exists).toBe(false)
    })
  })
})

describe('loadCiArtifactPayload', () => {
  test('value-based contribution — повертає value як є', () => {
    const result = loadCiArtifactPayload({ resourcePath: null, value: { a: 1 } })
    expect(result).toEqual({ ok: true, raw: { a: 1 } })
  })

  test('resource-based contribution — читає й парсить JSON з диска', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'artifact.json')
      await writeFile(p, JSON.stringify({ a: 2 }))
      const result = loadCiArtifactPayload({ resourcePath: p, value: undefined })
      expect(result).toEqual({ ok: true, raw: { a: 2 } })
    })
  })

  test('невалідний JSON на диску — ok:false', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'artifact.json')
      await writeFile(p, '{ не валідний json')
      const result = loadCiArtifactPayload({ resourcePath: p, value: undefined })
      expect(result.ok).toBe(false)
    })
  })
})
