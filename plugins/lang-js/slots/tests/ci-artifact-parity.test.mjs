/**
 * Parity-тест `ci.artifact@1` contributions `@7n/rules-lang-js` через РЕАЛЬНІ generic
 * consumer-адаптери `@7n/rules-ci-github`/`@7n/rules-ci-azure` (точне повторення реалізованого
 * PHP-патерну — без broker/discovery, напряму на дескрипторах і template-ах з `slots/ci/`):
 *
 * - github (`required-file`, `deep-subset`): T0 на порожньому tmp-репо створює
 *   `.github/workflows/lint-js.yml` БАЙТ-ІДЕНТИЧНИЙ канонічному template-у.
 * - azure (`patch-existing`, `contains-step`): fixture зі степом `n-rules lint js --no-fix` —
 *   чисто (0 violations); fixture без такого степу — violation.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCiArtifactPayload } from '@7n/rules/plugin-api'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import {
  applyDeepSubsetFix,
  diagnoseArtifact as diagnoseGithubArtifact,
  loadCanonicalTemplate
} from '@7n/rules-ci-github/slots/ci-artifact-consumer.mjs'
import {
  diagnoseArtifact as diagnoseAzureArtifact,
  loadCanonicalCommand
} from '@7n/rules-ci-azure/slots/ci-artifact-consumer.mjs'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CI_DIR = join(PACKAGE_ROOT, 'slots', 'ci')

/**
 * Валідує й повертає descriptor з `slots/ci/<file>.json` разом з `contribution`-provenance
 * (packageRoot + resourcePath) — той самий об'єктний контракт, що broker дає consumer-у.
 * @param {string} file імʼя дескриптора у `slots/ci/`
 * @returns {{ descriptor: import('@7n/rules/plugin-api').CiArtifactDescriptor, contribution: { packageRoot: string, resourcePath: string } }} descriptor + contribution
 */
function loadDescriptor(file) {
  const resourcePath = join(CI_DIR, file)
  const raw = JSON.parse(readFileSync(resourcePath, 'utf8'))
  const result = validateCiArtifactPayload(raw)
  if (!result.ok) throw new Error(`invalid descriptor ${file}: ${result.errors.join('; ')}`)
  return { descriptor: result.descriptor, contribution: { packageRoot: PACKAGE_ROOT, resourcePath } }
}

describe('ci-github: js-github-lint parity', () => {
  test('T0 на порожньому репо створює lint-js.yml байт-ідентичний template-у', async () => {
    const { descriptor, contribution } = loadDescriptor('js-github-lint.json')
    const loaded = await loadCanonicalTemplate(contribution, descriptor)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    await withTmpDir(async dir => {
      const fix = await applyDeepSubsetFix({
        cwd: dir,
        targetPath: descriptor.targetPath,
        canonical: loaded.canonical,
        templateText: loaded.templateText
      })
      expect(fix.touchedFiles).toHaveLength(1)

      const written = readFileSync(join(dir, descriptor.targetPath), 'utf8')
      expect(written).toBe(loaded.templateText)

      const after = await diagnoseGithubArtifact({
        cwd: dir,
        targetPath: descriptor.targetPath,
        canonical: loaded.canonical
      })
      expect(after.missing).toBe(false)
      expect(after.violations).toEqual([])
    })
  })
})

describe('ci-azure: js-azure-lint parity', () => {
  test('fixture зі степом "n-rules lint js --no-fix" — чисто, без violation', async () => {
    const { descriptor, contribution } = loadDescriptor('js-azure-lint.json')
    const loaded = await loadCanonicalCommand(contribution, descriptor)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.command).toBe('lint js')

    await withTmpDir(async dir => {
      await writeFile(
        join(dir, descriptor.targetPath),
        'steps:\n  - script: n-rules lint js --no-fix\n    displayName: Lint js\n'
      )
      const result = await diagnoseAzureArtifact({
        cwd: dir,
        targetPath: descriptor.targetPath,
        command: loaded.command
      })
      expect(result.applicable).toBe(true)
      expect(result.violations).toEqual([])
    })
  })

  test('fixture БЕЗ доменного lint-степу — violation', async () => {
    const { descriptor, contribution } = loadDescriptor('js-azure-lint.json')
    const loaded = await loadCanonicalCommand(contribution, descriptor)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    await withTmpDir(async dir => {
      await mkdir(dirname(join(dir, descriptor.targetPath)), { recursive: true })
      await writeFile(join(dir, descriptor.targetPath), 'steps:\n  - script: echo build\n')
      const result = await diagnoseAzureArtifact({
        cwd: dir,
        targetPath: descriptor.targetPath,
        command: loaded.command
      })
      expect(result.applicable).toBe(true)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
