/**
 * Parity-тест реальних `ci.artifact@1` fixtures `@7n/rules-lang-python` проти generic
 * consumer-adapter-ів `@7n/rules-ci-github`/`@7n/rules-ci-azure` (той самий контракт, що
 * `ci-artifact-descriptors.test.mjs` перевіряє формально) — на відміну від того файлу, тут
 * прогін через РЕАЛЬНУ поведінку adapter-а: T0 має вивести `.github/workflows/lint-python.yml`
 * байт-у-байт ідентичним канонічному template-у (`required-file`, `deep-subset`), а
 * azure-adapter має коректно validate/diagnose `contains-step` крок `n-rules lint python
 * --no-fix` у `azure-pipelines.yml`. Consumer-и — той самий generic код, що
 * обслуговує PHP (`plugins/ci-github/slots/ci-artifact-consumer.mjs`,
 * `plugins/ci-azure/slots/ci-artifact-consumer.mjs`); тут викликаються напряму з нашими
 * реальними дескрипторами/шаблонами — без fake-плагінів у `node_modules`/`.n-rules.json`.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCiArtifactPayload } from '@7n/rules/plugin-api'
import {
  applyDeepSubsetFix,
  diagnoseArtifact as diagnoseGithub,
  loadCanonicalTemplate
} from '@7n/rules-ci-github/slots/ci-artifact-consumer.mjs'
import {
  diagnoseArtifact as diagnoseAzure,
  loadCanonicalCommand
} from '@7n/rules-ci-azure/slots/ci-artifact-consumer.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CI_DIR = join(PACKAGE_ROOT, 'slots', 'ci')

/**
 * Читає й валідує один descriptor файл, повертає `{ contribution, descriptor }` — та сама форма,
 * що `collectArtifacts` віддає generic-у consumer-у.
 * @param {string} file ім'я файлу дескриптора у `slots/ci/`
 * @returns {{ contribution: { packageRoot: string, resourcePath: string }, descriptor: import('@7n/rules/plugin-api').CiArtifactDescriptor }} валідований candidate
 */
function loadDescriptor(file) {
  const resourcePath = join(CI_DIR, file)
  const raw = JSON.parse(readFileSync(resourcePath, 'utf8'))
  const result = validateCiArtifactPayload(raw)
  if (!result.ok) throw new Error(`невалідний descriptor ${file}: ${result.errors.join('; ')}`)
  return { contribution: { packageRoot: PACKAGE_ROOT, resourcePath }, descriptor: result.descriptor }
}

describe('github ci.artifact consumer parity (lint-python.yml)', () => {
  const { contribution, descriptor } = loadDescriptor('python-github-lint.json')

  test('T0 на порожньому репо — файл байт-у-байт ідентичний canonical template', async () => {
    await withTmpDir(async dir => {
      const templateResult = await loadCanonicalTemplate(contribution, descriptor)
      expect(templateResult.ok).toBe(true)
      if (!templateResult.ok) return

      const before = await diagnoseGithub({
        cwd: dir,
        targetPath: descriptor.targetPath,
        canonical: templateResult.canonical
      })
      expect(before.missing).toBe(true)

      const fixResult = await applyDeepSubsetFix({
        cwd: dir,
        targetPath: descriptor.targetPath,
        canonical: templateResult.canonical,
        templateText: templateResult.templateText
      })
      expect(fixResult.touchedFiles).toHaveLength(1)

      const written = readFileSync(join(dir, descriptor.targetPath), 'utf8')
      expect(written).toBe(templateResult.templateText)

      const after = await diagnoseGithub({
        cwd: dir,
        targetPath: descriptor.targetPath,
        canonical: templateResult.canonical
      })
      expect(after.missing).toBe(false)
      expect(after.violations).toHaveLength(0)
    })
  })

  test('deep-subset: workflow без canonical lint-кроку → violation', async () => {
    await withTmpDir(async dir => {
      const templateResult = await loadCanonicalTemplate(contribution, descriptor)
      if (!templateResult.ok) throw new Error(templateResult.reason)

      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(
        join(dir, descriptor.targetPath),
        "name: Lint Python\non:\n  push:\n    paths:\n      - '**/*.py'\njobs:\n  python:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n"
      )

      const diag = await diagnoseGithub({
        cwd: dir,
        targetPath: descriptor.targetPath,
        canonical: templateResult.canonical
      })
      expect(diag.missing).toBe(false)
      expect(diag.violations.length).toBeGreaterThan(0)
      expect(diag.violations.some(v => v.includes('astral-sh/setup-uv'))).toBe(true)
    })
  })
})

describe('azure ci.artifact consumer parity (azure-pipelines.yml)', () => {
  const { contribution, descriptor } = loadDescriptor('python-azure-lint.json')

  test('canonical command резолвиться з template як "lint python" (без бінарного prefix і --no-fix)', async () => {
    const commandResult = await loadCanonicalCommand(contribution, descriptor)
    expect(commandResult.ok).toBe(true)
    if (commandResult.ok) expect(commandResult.command).toBe('lint python')
  })

  test('pipeline без canonical lint-кроку → violation', async () => {
    await withTmpDir(async dir => {
      const commandResult = await loadCanonicalCommand(contribution, descriptor)
      if (!commandResult.ok) throw new Error(commandResult.reason)

      await writeFile(join(dir, descriptor.targetPath), 'trigger:\n  - main\nsteps:\n  - script: echo build\n')
      const diag = await diagnoseAzure({ cwd: dir, targetPath: descriptor.targetPath, command: commandResult.command })
      expect(diag.applicable).toBe(true)
      expect(diag.violations.some(v => v.includes('lint python'))).toBe(true)
    })
  })

  test('pipeline з canonical `n-rules lint python --no-fix` кроком → без violations', async () => {
    await withTmpDir(async dir => {
      const commandResult = await loadCanonicalCommand(contribution, descriptor)
      if (!commandResult.ok) throw new Error(commandResult.reason)

      await writeFile(
        join(dir, descriptor.targetPath),
        'trigger:\n  - main\nsteps:\n  - script: bunx n-rules lint python --no-fix\n    displayName: Lint python\n'
      )
      const diag = await diagnoseAzure({ cwd: dir, targetPath: descriptor.targetPath, command: commandResult.command })
      expect(diag.applicable).toBe(true)
      expect(diag.violations).toHaveLength(0)
    })
  })

  test('canonical крок є, але без "--no-fix" → violation', async () => {
    await withTmpDir(async dir => {
      const commandResult = await loadCanonicalCommand(contribution, descriptor)
      if (!commandResult.ok) throw new Error(commandResult.reason)

      await writeFile(
        join(dir, descriptor.targetPath),
        'trigger:\n  - main\nsteps:\n  - script: bunx n-rules lint python\n    displayName: Lint python\n'
      )
      const diag = await diagnoseAzure({ cwd: dir, targetPath: descriptor.targetPath, command: commandResult.command })
      expect(diag.applicable).toBe(true)
      expect(diag.violations.some(v => v.includes('--no-fix'))).toBe(true)
    })
  })

  test('pipeline відсутній → applicable: false (окремий концерн azure-pipelines)', async () => {
    await withTmpDir(async dir => {
      const commandResult = await loadCanonicalCommand(contribution, descriptor)
      if (!commandResult.ok) throw new Error(commandResult.reason)
      const diag = await diagnoseAzure({ cwd: dir, targetPath: descriptor.targetPath, command: commandResult.command })
      expect(diag.applicable).toBe(false)
      expect(diag.violations).toHaveLength(0)
    })
  })
})
