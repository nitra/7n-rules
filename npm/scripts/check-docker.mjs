/**
 * Запускає hadolint для Dockerfile / Containerfile у всьому репозиторії (див. docker.mdc).
 *
 * Додатково переконуються, що образи `oven/bun`, `alpine`, `nginx`, `node` з Docker Hub
 * вказуються через `mirror.gcr.io` (див. `utils/docker-mirror.mjs`).
 *
 * Також перевіряє, що Dockerfile/Containerfile має **multistage build** і що фінальний stage
 * використовує мінімальний runtime-образ:
 * - backend: `mirror.gcr.io/library/alpine:*`
 * - frontend: `mirror.gcr.io/library/nginx:*`
 *
 * Мета — щоб у фінальному образі не було build tooling (Bun/Node та залежностей), а лише
 * runtime (alpine) або nginx.
 *
 * Знаходить Dockerfile, Dockerfile.*, Containerfile, Containerfile.*; пропускає node_modules, .git
 * тощо. Спочатку hadolint з PATH, інакше docker run з образом hadolint/hadolint.
 * Кореневий .hadolint.yaml підхоплюється hadolint автоматично.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { getMirrorGcrHint, getFromImageToken } from './utils/docker-mirror.mjs'
import { lintDockerfileWithHadolint, posixRel } from './utils/docker-hadolint.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { walkDir } from './utils/walkDir.mjs'

/**
 * @typedef {{
 *   line: number
 *   image: string
 * }} FromStage
 */

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
 * Витягує всі `FROM <image>` зі вмісту Dockerfile/Containerfile.
 *
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {FromStage[]} список знайдених FROM-інструкцій
 */
export function parseFromStages(fileContent) {
  const out = []
  const lines = fileContent.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const image = getFromImageToken(lines[i])
    if (image) out.push({ line: i + 1, image })
  }
  return out
}

const RUNTIME_IMAGES = /** @type {const} */ ([
  'mirror.gcr.io/library/alpine',
  'mirror.gcr.io/library/nginx'
])

/**
 * Перевіряє базові вимоги до структури Dockerfile:
 * - multistage: мінімум 2 FROM
 * - фінальний FROM: alpine або nginx з mirror.gcr.io
 *
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {string | null} повідомлення помилки або null
 */
export function getMultistageAndRuntimeHint(fileContent) {
  const stages = parseFromStages(fileContent)
  if (stages.length === 0) return null

  if (stages.length < 2) {
    return 'має бути multistage build: мінімум 2 інструкції FROM (build stage + runtime stage)'
  }

  const last = stages.at(-1)
  const lastImage = (last?.image || '').split('@')[0] || ''
  const lastLower = lastImage.toLowerCase()

  const okRuntime = RUNTIME_IMAGES.some(img => lastLower.startsWith(`${img}:`) || lastLower === img)
  if (!okRuntime) {
    return `фінальний FROM має бути ${RUNTIME_IMAGES.join(' або ')} (runtime stage), зараз: ${last?.image} (рядок ${last?.line})`
  }

  return null
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

    const multistageHint = getMultistageAndRuntimeHint(content)
    if (multistageHint) {
      fail(`${rel} (multistage): ${multistageHint}`)
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
