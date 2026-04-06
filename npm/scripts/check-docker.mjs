/**
 * Запускає hadolint для Dockerfile / Containerfile у всьому репозиторії (див. docker.mdc).
 *
 * Знаходить Dockerfile, Dockerfile.*, Containerfile, Containerfile.*; пропускає node_modules, .git
 * тощо. Спочатку hadolint з PATH, інакше docker run з образом hadolint/hadolint.
 * Кореневий .hadolint.yaml підхоплюється hadolint автоматично.
 */
import { basename } from 'node:path'

import { lintDockerfileWithHadolint, posixRel } from './utils/docker-hadolint.mjs'
import { pass } from './utils/pass.mjs'
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
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const root = process.cwd()
  const files = await findDockerfilePaths(root)

  if (files.length === 0) {
    pass('Немає Dockerfile / Containerfile — перевірку hadolint пропущено')
    return 0
  }

  pass(`Знайдено файлів для hadolint: ${files.length}`)

  for (const abs of files) {
    const rel = posixRel(root, abs) || basename(abs)
    const { ok, stdout, stderr, via } = lintDockerfileWithHadolint(root, abs)
    const tail = (stdout + stderr).trim()
    if (ok) {
      pass(`${rel} (${via})`)
    } else {
      fail(`${rel} (${via})${tail ? `:\n${tail}` : ''}`)
    }
  }

  return exitCode
}
