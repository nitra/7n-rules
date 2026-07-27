/**
 * Інтеграційний тест трьох `ci.artifact@1` contributions `@7n/rules-lang-php` (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §6, §7.1, §10 Фаза 4 п.6): кожен
 * descriptor у `slots/ci/*.json` має пройти canonical payload-контракт
 * (`validateCiArtifactPayload`) і його `template` резолвиться (`resolveArtifactTemplatePath`) у
 * реальний файл на диску тим самим контрактним path-резолвом — без broker/discovery, лише
 * форма й containment, той самий контракт, що читають `@7n/rules-ci-github`/`@7n/rules-ci-azure`.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveArtifactTemplatePath, validateCiArtifactPayload } from '@7n/rules/plugin-api'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CI_DIR = join(PACKAGE_ROOT, 'slots', 'ci')

/** @type {Array<{ file: string, expected: Partial<import('@7n/rules/plugin-api').CiArtifactDescriptor> }>} */
const DESCRIPTORS = [
  {
    file: 'php-github-lint.json',
    expected: { targetCapability: 'ci:github', mode: 'required-file', mergeStrategy: 'deep-subset', fix: true }
  },
  {
    file: 'php-azure-lint.json',
    expected: { targetCapability: 'ci:azure', mode: 'patch-existing', mergeStrategy: 'contains-step', fix: false }
  },
  {
    file: 'php-lint-text-patch.json',
    expected: { targetCapability: 'ci:github', mode: 'patch-existing', mergeStrategy: 'deep-subset', fix: true }
  }
]

describe.each(DESCRIPTORS)('$file', ({ file, expected }) => {
  const raw = JSON.parse(readFileSync(join(CI_DIR, file), 'utf8'))

  test('проходить validateCiArtifactPayload', () => {
    const result = validateCiArtifactPayload(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.descriptor).toMatchObject(expected)
    }
  })

  test('template резолвиться у реальний файл на диску (containment у packageRoot)', () => {
    const result = validateCiArtifactPayload(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const contribution = { packageRoot: PACKAGE_ROOT, resourcePath: join(CI_DIR, file) }
    const resolved = resolveArtifactTemplatePath(contribution, result.descriptor)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.exists).toBe(true)
  })
})

describe('artifactId collision key', () => {
  test('github і azure lint-контрибуції можуть ділити artifactId "lint-php" — різні targetCapability, різні consumer-и', () => {
    const github = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'php-github-lint.json'), 'utf8')))
    const azure = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'php-azure-lint.json'), 'utf8')))
    expect(github.ok && azure.ok).toBe(true)
    if (github.ok && azure.ok) {
      expect(github.descriptor.artifactId).toBe(azure.descriptor.artifactId)
      expect(github.descriptor.targetCapability).not.toBe(azure.descriptor.targetCapability)
    }
  })

  test('lint-text-патч має ВІДМІННИЙ artifactId від github lint-workflow contribution (той самий targetCapability)', () => {
    const github = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'php-github-lint.json'), 'utf8')))
    const patch = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'php-lint-text-patch.json'), 'utf8')))
    expect(github.ok && patch.ok).toBe(true)
    if (github.ok && patch.ok) expect(github.descriptor.artifactId).not.toBe(patch.descriptor.artifactId)
  })
})
