/**
 * Концерн `stryker_config` правила test (test.mdc): якщо `js-lint` присутнє в
 * `.n-cursor.json#rules` і не у `disable-rules` — резолвить ВСІ JS-roots
 * (всі workspaces з package.json, або cwd у single-package) і копіює canonical
 * baseline `stryker.config.mjs` + `vitest.config.js` у кожен root, де файлу немає.
 *
 * Self-gating: концерн silently skips коли `js-lint` не enabled — це навмисно,
 * щоб не шуміти у single-language проєктах без JS coverage tooling.
 *
 * Baseline — мінімум для запуску Stryker з vitest-runner + perTest; mutate-патерни
 * лишаються на Stryker defaults (`src/**\/*.{js,mjs,ts,jsx,tsx,cjs}`).
 */
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { ensureGitignoreEntries } from '../../../scripts/utils/ensure-gitignore-entries.mjs'
import { resolveAllJsRoots } from '../../../scripts/utils/resolve-js-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const STRYKER_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.baseline.mjs')
const VITEST_BASELINE_PATH = join(HERE, 'data', 'vitest_config', 'vitest.config.baseline.js')

// Stryker-output патерн для .gitignore: увесь каталог reports/stryker/ — це
// build-артефакти (`tempDirName` backup'и, mutation.json, HTML/dashboard-репорти
// якщо користувач додасть інші reporter-и). Покриваємо одним патерном замість
// перелічування під-патернів. Подвійний-зірочка-префікс — для monorepo workspaces.
const STRYKER_GITIGNORE_ENTRIES = ['**/reports/stryker/']

/**
 * Копіює baseline у target, якщо target ще не існує. Idempotent.
 * @param {ReturnType<typeof createCheckReporter>} reporter check-reporter для логу pass/fail
 * @param {string} cwd корінь проєкту (для relative-шляхів у логах)
 * @param {string} baselinePath абсолютний шлях до canonical baseline
 * @param {string} target абсолютний шлях, куди копіювати
 * @param {string} label людиночитна мітка ("stryker.config.mjs" / "vitest.config.js")
 * @returns {Promise<void>}
 */
async function ensureBaselineFile(reporter, cwd, baselinePath, target, label) {
  if (existsSync(target)) {
    reporter.pass(`${label} існує (${relative(cwd, target)})`)
    return
  }
  await copyFile(baselinePath, target)
  reporter.pass(`${label} створено з canonical baseline (${relative(cwd, target)}) (test.mdc)`)
}

/**
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function check() {
  const reporter = createCheckReporter()
  const cwd = process.cwd()
  const config = await readNCursorConfigLite(cwd)

  // Self-gate: js-lint має бути enabled
  if (!config.rules.includes('js-lint') || config.disableRules.includes('js-lint')) {
    return reporter.getExitCode()
  }

  const jsRoots = await resolveAllJsRoots(cwd)
  if (jsRoots.length === 0) {
    reporter.fail('test: js-lint enabled, але кореневий package.json не знайдено (test.mdc)')
    return reporter.getExitCode()
  }

  for (const baselinePath of [STRYKER_BASELINE_PATH, VITEST_BASELINE_PATH]) {
    if (!existsSync(baselinePath)) {
      reporter.fail(`canonical baseline не знайдено (${baselinePath}) — перевстанови @nitra/cursor`)
      return reporter.getExitCode()
    }
  }

  for (const jsRoot of jsRoots) {
    await ensureBaselineFile(reporter, cwd, STRYKER_BASELINE_PATH, join(jsRoot, 'stryker.config.mjs'), 'stryker.config.mjs')
    await ensureBaselineFile(reporter, cwd, VITEST_BASELINE_PATH, join(jsRoot, 'vitest.config.js'), 'vitest.config.js')
  }

  // Гарантуємо що Stryker temp/output ніколи не комітяться. Patterns
  // покривають усі workspaces через `**/`-префікс (єдиний root .gitignore).
  const { added } = await ensureGitignoreEntries(cwd, STRYKER_GITIGNORE_ENTRIES, 'Stryker mutation testing (test.mdc)')
  if (added.length > 0) {
    reporter.pass(`.gitignore: додано Stryker-патерни (${added.join(', ')}) (test.mdc)`)
  }
  return reporter.getExitCode()
}
