/** @see ./docs/marksman_config.md */
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARKSMAN_BASELINE_PATH = join(HERE, 'data', 'marksman_config', 'marksman.baseline.toml')
const MARKSMAN_TARGET_FILENAME = '.marksman.toml'

/**
 * @param {string} [cwd] корінь проєкту (default: `process.cwd()` — CLI-сумісність)
 * @returns {Promise<number>} 0 — OK (створено або вже існує), 1 — baseline-файл пакета зламаний
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()

  if (!existsSync(MARKSMAN_BASELINE_PATH)) {
    reporter.fail(`canonical baseline не знайдено (${MARKSMAN_BASELINE_PATH}) — перевстанови @nitra/cursor`)
    return reporter.getExitCode()
  }

  const target = join(cwd, MARKSMAN_TARGET_FILENAME)
  if (existsSync(target)) {
    reporter.pass(`${MARKSMAN_TARGET_FILENAME} існує (${relative(cwd, target)})`)
    return reporter.getExitCode()
  }

  await copyFile(MARKSMAN_BASELINE_PATH, target)
  reporter.pass(`${MARKSMAN_TARGET_FILENAME} створено з canonical baseline (${relative(cwd, target)}) (ci4.mdc)`)
  return reporter.getExitCode()
}
