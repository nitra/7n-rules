/**
 * run-docker (скрипт lint-docker): hadolint лише для файлів з іменем Dockerfile та суфіксом .dockerfile (див. docker.mdc).
 *
 * Обхід дерева як у check-docker (walkDir, ті самі пропуски каталогів). На відміну від
 * check docker, не обробляються Dockerfile.*, Containerfile тощо — лише канонічне ім’я
 * Dockerfile та варіанти виду app.Dockerfile (регістр суфікса не важливий).
 *
 * Виклик hadolint — через ../js/lint/docker-hadolint.mjs (PATH або docker run).
 *
 * Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) —
 * `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
 */
import { basename } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { lintDockerfileWithHadolint, posixRel } from '../utils/docker-hadolint.mjs'
import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { runStandardLint } from '../../../scripts/utils/run-standard-lint.mjs'

/**
 * Чи входить файл до набору lint-docker: Dockerfile або *.Dockerfile (*.dockerfile).
 * @param {string} name basename шляху
 * @returns {boolean} true, якщо ім’я підходить під lint-docker
 */
export function isLintDockerfileName(name) {
  const n = name.toLowerCase()
  if (n === 'dockerfile') return true
  return n.endsWith('.dockerfile') && n.length > '.dockerfile'.length
}

/**
 * Збирає абсолютні шляхи для lint-docker.
 * @param {string} root корінь репозиторію
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи
 */
export async function findLintDockerfilePaths(root, ignorePaths = []) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    p => {
      if (isLintDockerfileName(basename(p))) out.push(p)
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Внутрішні кроки `lint-docker` без локу: hadolint по Dockerfile та *.Dockerfile.
 * @returns {Promise<number>} 0 — OK, 1 — зауваження або помилка
 */
async function runLintDockerSteps() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  const files = await findLintDockerfilePaths(root, ignorePaths)

  if (files.length === 0) {
    pass('lint-docker: немає Dockerfile / *.Dockerfile — hadolint пропущено')
    return reporter.getExitCode()
  }

  pass(`lint-docker: файлів для hadolint: ${files.length}`)

  for (const abs of files) {
    const rel = posixRel(root, abs) || basename(abs)
    const { ok, stdout, stderr, via } = lintDockerfileWithHadolint(root, abs)
    const tail = (stdout + stderr).trim()
    if (ok) {
      pass(`${rel} (${via})`)
    } else {
      const detail = tail ? `:\n${tail}` : ''
      fail(`${rel} (${via})${detail}`)
    }
  }

  return reporter.getExitCode()
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-docker')` + дедуп за станом git-дерева.
 * Експортовано як `runLintDocker` — використовується з `bin/n-cursor.js` як підкоманда `lint-docker`.
 * @returns {Promise<number>} код виходу
 */
export const runLintDocker = () => runStandardLint(import.meta.dirname, runLintDockerSteps)

if (isRunAsCli()) {
  process.exitCode = await runLintDocker()
}
