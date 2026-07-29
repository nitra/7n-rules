/**
 * Інтеграційний тест двох `ci.artifact@1` contributions `@7n/rules-lang-js` (точне
 * повторення реалізованого PHP-патерну, `@7n/rules-lang-php`'s
 * `slots/tests/ci-artifact-descriptors.test.mjs`) — спільний канон (`describeCiArtifactDescriptors`)
 * винесено в `@7n/rules/scripts/utils/tests/ci-artifact-descriptor-tests.mjs` (jscpd: обидва
 * мовні плагіни інакше дублювали ідентичний `describe.each`-блок).
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
      file: 'js-lint-text-patch.json',
      expected: { targetCapability: 'ci:github', mode: 'patch-existing', mergeStrategy: 'deep-subset', fix: true }
    },
    {
      file: 'js-github-lint.json',
      expected: { targetCapability: 'ci:github', mode: 'required-file', mergeStrategy: 'deep-subset', fix: true }
    },
    {
      file: 'js-azure-lint.json',
      expected: { targetCapability: 'ci:azure', mode: 'patch-existing', mergeStrategy: 'contains-step', fix: false }
    }
  ]
})

describe('artifactId collision key', () => {
  test('github і azure lint-контрибуції можуть ділити artifactId "lint-js" — різні targetCapability, різні consumer-и', () => {
    const github = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'js-github-lint.json'), 'utf8')))
    const azure = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'js-azure-lint.json'), 'utf8')))
    expect(github.ok && azure.ok).toBe(true)
    if (github.ok && azure.ok) {
      expect(github.descriptor.artifactId).toBe(azure.descriptor.artifactId)
      expect(github.descriptor.targetCapability).not.toBe(azure.descriptor.targetCapability)
    }
  })
})
