/**
 * Концерн `stryker_config` правила test (test.mdc): якщо `js-lint` присутнє в
 * `.n-cursor.json#rules` і не у `disable-rules` — визначає ВСІ JS-roots
 * (всі workspaces з package.json, або cwd у single-package) і копіює canonical
 * baseline `stryker.config.mjs` + `vitest.config.js` у кожен root, де файлу немає.
 *
 * Для JS-roots із `.vue` файлами (Vue 3 + `<script setup>`) копіюється vue-варіант
 * baseline, який реєструє локальний Ignore-плагін `vue-macros` — інакше Stryker
 * огортає виклики `defineProps`/`defineEmits`/... у coverage-тернарник і
 * `@vue/compiler-sfc` падає при компіляції SFC. Плагін копіюється у той самий
 * jsRoot як `stryker-vue-macros-ignorer.mjs`.
 *
 * Self-gating: концерн silently skips коли `js-lint` не enabled — це навмисно,
 * щоб не шуміти у single-language проєктах без JS coverage tooling.
 *
 * Baseline — мінімум для запуску Stryker з vitest-runner + perTest; mutate-патерни
 * лишаються на Stryker defaults (`src/**\/*.{js,mjs,ts,jsx,tsx,cjs}`).
 */
import { existsSync } from 'node:fs'
import { copyFile, glob } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { ensureGitignoreEntries } from '../../../scripts/utils/ensure-gitignore-entries.mjs'
import { resolveAllJsRoots } from '../../../scripts/utils/resolve-js-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const STRYKER_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.baseline.mjs')
const STRYKER_VUE_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.vue.baseline.mjs')
const STRYKER_VUE_PLUGIN_PATH = join(HERE, 'data', 'stryker_config', 'stryker-vue-macros-ignorer.mjs')
const STRYKER_VUE_PLUGIN_FILENAME = 'stryker-vue-macros-ignorer.mjs'
const VITEST_BASELINE_PATH = join(HERE, 'data', 'vitest_config', 'vitest.config.baseline.js')

// Тест-артефакти для .gitignore (подвійний-зірочка-префікс — для monorepo workspaces):
// - `**/reports/stryker/` — увесь каталог Stryker-output-у (`tempDirName` backup'и,
//   mutation.json, HTML/dashboard-репорти якщо користувач додасть інші reporter-и).
// - `**/coverage/` — весь output vitest v8 coverage (`lcov.info` + HTML `lcov-report/`).
//   Ефемерний: регенерується кожним прогоном; фінальні метрики живуть у `COVERAGE.md`.
//   Gitignore не заважає `n-cursor coverage` читати `lcov.info` у тому ж прогоні.
// Покриваємо каталогами замість перелічування під-патернів.
const TEST_GITIGNORE_ENTRIES = ['**/reports/stryker/', '**/coverage/']

// .vue detection: scope — `<jsRoot>/src/**/*.vue` (як і Stryker mutate defaults для src/);
// skip build-артефактів і чужих node_modules, щоб не вмикати vue-варіант через transitive deps.
const VUE_GLOB_PATTERN = 'src/**/*.vue'
const VUE_GLOB_IGNORE = ['**/node_modules/**', '**/dist/**', '**/reports/**']

/**
 * Чи містить jsRoot хоч один `.vue` файл під `src/` (skipping node_modules/dist/reports).
 * @param {string} jsRoot абсолютний шлях до workspace-каталогу
 * @returns {Promise<boolean>} true якщо знайдено хоча б один `.vue`
 */
async function hasVueFiles(jsRoot) {
  for await (const _rel of glob(VUE_GLOB_PATTERN, { cwd: jsRoot, exclude: VUE_GLOB_IGNORE })) {
    return true
  }
  return false
}

/**
 * Копіює baseline у target, якщо target ще не існує. Idempotent.
 * @param {ReturnType<typeof createCheckReporter>} reporter check-reporter для логу pass/fail
 * @param {string} cwd корінь проєкту (для relative-шляхів у логах)
 * @param {string} baselinePath абсолютний шлях до canonical baseline
 * @param {string} target абсолютний шлях, куди копіювати
 * @param {string} label зрозуміла для людини мітка ("stryker.config.mjs" / "vitest.config.js")
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
 * @param {string} [cwd] корінь проєкту (default: `process.cwd()` — CLI-сумісність)
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
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

  for (const baselinePath of [
    STRYKER_BASELINE_PATH,
    STRYKER_VUE_BASELINE_PATH,
    STRYKER_VUE_PLUGIN_PATH,
    VITEST_BASELINE_PATH
  ]) {
    if (!existsSync(baselinePath)) {
      reporter.fail(`canonical baseline не знайдено (${baselinePath}) — перевстанови @nitra/cursor`)
      return reporter.getExitCode()
    }
  }

  for (const jsRoot of jsRoots) {
    const isVueRoot = await hasVueFiles(jsRoot)
    const strykerBaseline = isVueRoot ? STRYKER_VUE_BASELINE_PATH : STRYKER_BASELINE_PATH
    await ensureBaselineFile(
      reporter,
      cwd,
      strykerBaseline,
      join(jsRoot, 'stryker.config.mjs'),
      'stryker.config.mjs'
    )
    if (isVueRoot) {
      await ensureBaselineFile(
        reporter,
        cwd,
        STRYKER_VUE_PLUGIN_PATH,
        join(jsRoot, STRYKER_VUE_PLUGIN_FILENAME),
        STRYKER_VUE_PLUGIN_FILENAME
      )
    }
    await ensureBaselineFile(reporter, cwd, VITEST_BASELINE_PATH, join(jsRoot, 'vitest.config.js'), 'vitest.config.js')
  }

  // Гарантуємо що тест-артефакти (Stryker output, lcov HTML-звіт) ніколи не
  // потрапляють у commit. Patterns покривають усі workspaces через `**/`-префікс
  // (єдиний root .gitignore).
  const { added } = await ensureGitignoreEntries(cwd, TEST_GITIGNORE_ENTRIES, 'Test artifacts: Stryker + coverage (test.mdc)')
  if (added.length > 0) {
    reporter.pass(`.gitignore: додано тест-патерни (${added.join(', ')}) (test.mdc)`)
  }
  return reporter.getExitCode()
}
