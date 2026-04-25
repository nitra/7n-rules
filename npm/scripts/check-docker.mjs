/**
 * Запускає hadolint для Dockerfile / Containerfile у всьому репозиторії (див. docker.mdc).
 *
 * Додатково переконуються, що образи `oven/bun`, `alpine`, `nginx`, `node` з Docker Hub
 * вказуються через `mirror.gcr.io` (див. `utils/docker-mirror.mjs`).
 *
 * Знаходить Dockerfile, Dockerfile.*, Containerfile, Containerfile.*; пропускає node_modules, .git
 * тощо. Спочатку hadolint з PATH, інакше docker run з образом hadolint/hadolint.
 * Кореневий .hadolint.yaml підхоплюється hadolint автоматично.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { getMirrorGcrHint } from './utils/docker-mirror.mjs'
import { lintDockerfileWithHadolint, posixRel } from './utils/docker-hadolint.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { walkDir } from './utils/walkDir.mjs'

/**
 * Чи є basename Dockerfile / Containerfile (у т.ч. Dockerfile.prod).
 * @param {string} name basename шляху
 * @returns {boolean} true для Dockerfile / Dockerfile.* / Containerfile / Containerfile.*
 */
export function isDockerfileName(name) {
  const n = name.toLowerCase()
  if (n === 'dockerfile' || n === 'containerfile') return true
  if (n.startsWith('dockerfile.') || n.startsWith('containerfile.')) return true
  return false
}

/**
 * Збирає абсолютні шляхи до Dockerfile / Containerfile від кореня cwd.
 * @param {string} root корінь репозиторію
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи
 */
export async function findDockerfilePaths(root) {
  /** @type {string[]} */
  const out = []
  await walkDir(root, p => {
    if (isDockerfileName(basename(p))) out.push(p)
  })
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Перевіряє Dockerfile / Containerfile через hadolint (docker.mdc).
 * @returns {Promise<number>} 0 — все OK, 1 — є зауваження або помилка запуску
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()
  const files = await findDockerfilePaths(root)

  if (files.length === 0) {
    pass('Немає Dockerfile / Containerfile — перевірку hadolint пропущено')
    return reporter.getExitCode()
  }

  pass(`Знайдено файлів для hadolint: ${files.length}`)

  for (const abs of files) {
    const rel = posixRel(root, abs) || basename(abs)
    const content = await readFile(abs, 'utf8')
    const hint = getMirrorGcrHint(content)
    if (hint) {
      fail(`${rel} (mirror.gcr.io): ${hint}`)
    }

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
