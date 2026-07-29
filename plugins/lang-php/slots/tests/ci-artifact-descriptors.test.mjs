/**
 * Інтеграційний тест трьох `ci.artifact@1` contributions `@7n/rules-lang-php` (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §6, §7.1, §10 Фаза 4 п.6) —
 * спільний канон (`describeCiArtifactDescriptors`) винесено в
 * `@7n/rules/scripts/utils/tests/ci-artifact-descriptor-tests.mjs` (jscpd: `@7n/rules-lang-js`
 * інакше дублював ідентичний `describe.each`-блок для власних дескрипторів).
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCiArtifactPayload } from '@7n/rules/plugin-api'
import { describeCiArtifactDescriptors } from '@7n/rules/scripts/utils/tests/ci-artifact-descriptor-tests.mjs'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CI_DIR = join(PACKAGE_ROOT, 'slots', 'ci')

describeCiArtifactDescriptors({
  packageRoot: PACKAGE_ROOT,
  ciDir: CI_DIR,
  cases: [
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
