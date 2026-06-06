/** @see ./docs/cargo_mutants_config.md */
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { resolveAllCargoManifests } from '../../../scripts/utils/resolve-cargo-manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = join(HERE, 'data', 'cargo_mutants_config', 'mutants.toml.baseline')

/**
 * @param {string} [cwd] корінь проєкту (default: `process.cwd()` — CLI-сумісність)
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const config = await readNCursorConfigLite(cwd)

  // Self-gate: rust має бути enabled
  if (!config.rules.includes('rust') || config.disableRules.includes('rust')) {
    return reporter.getExitCode()
  }

  const manifests = await resolveAllCargoManifests(cwd)
  if (manifests.length === 0) {
    // rust enabled, але Cargo.toml ще немає — silently skip (manifest може з'явитися пізніше)
    return reporter.getExitCode()
  }

  if (!existsSync(BASELINE_PATH)) {
    reporter.fail(`.cargo/mutants.toml canonical baseline не знайдено (${BASELINE_PATH}) — перевстанови @nitra/cursor`)
    return reporter.getExitCode()
  }

  for (const manifestPath of manifests) {
    const cargoDir = dirname(manifestPath)
    const target = join(cargoDir, '.cargo', 'mutants.toml')

    if (existsSync(target)) {
      reporter.pass(`.cargo/mutants.toml існує (${relative(cwd, target)})`)
      continue
    }

    await mkdir(dirname(target), { recursive: true })
    await copyFile(BASELINE_PATH, target)
    reporter.pass(`.cargo/mutants.toml створено з canonical baseline (${relative(cwd, target)}) (test.mdc)`)
  }
  return reporter.getExitCode()
}
