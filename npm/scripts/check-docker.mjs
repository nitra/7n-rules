/**
 * Запускає hadolint для Dockerfile / Containerfile у всьому репозиторії (див. docker.mdc).
 *
 * Додатково переконуються, що образи `oven/bun`, `alpine`, `nginx`, `node` з Docker Hub
 * вказуються через `mirror.gcr.io` (див. `utils/docker-mirror.mjs`).
 *
 * Також перевіряє, що Dockerfile/Containerfile має **multistage build** і що фінальний stage
 * використовує дозволений runtime-образ (див. docker.mdc):
 * - backend: `mirror.gcr.io/library/alpine:*`, `scratch`, `mirror.gcr.io/library/debian:` з тегом, що
 *   містить `slim` (не повний `debian:bookworm`), за винятком PHP/Python — `mirror.gcr.io/library/php:*` або
 *   `mirror.gcr.io/library/python:*`
 * - frontend: `mirror.gcr.io/nginxinc/nginx-unprivileged:*`, `mirror.gcr.io/openresty/openresty:*`
 *
 * Якщо в Dockerfile є крок `bun install` і це не frontend-образ (фінальний stage — alpine),
 * то очікується компіляція в один бінарник через `bun build --compile` у build stage, а у
 * фінальному stage не повинно залишатися build tooling (Bun/Node).
 *
 * Мета — щоб у фінальному образі не було build tooling (Bun/Node та залежностей), а лише
 * дозволений runtime (alpine, scratch, debian slim, за потреби php/python, nginx або openresty).
 *
 * Для nginx-образів (`mirror.gcr.io/nginxinc/nginx-unprivileged`) у будь-якому `FROM` очікується
 * тег `alpine-slim` (docker.mdc: мінімальні образи), не `latest` /
 * `alpine` / інші. `nginx-unprivileged` запускається від не-root користувача (uid=101) без явного
 * `USER` у Dockerfile — перевірка non-root для нього пропускається.
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
import { loadCursorIgnorePaths } from './utils/load-cursor-config.mjs'
import { walkDir } from './utils/walkDir.mjs'

const NEWLINE_RE = /\r?\n/
const BUN_INSTALL_RE = /\bbun\s+(?:install|i)\b/iu
const BUN_BUILD_COMPILE_RE = /\bbun\s+build\b[^\n]*\s--compile\b/iu
const BUN_WORD_RE = /\bbun\b/iu
const USER_LINE_RE = /^\s*USER\s+([^\s#]+)/iu

const NGINX_UNPRIVILEGED_MIRROR_PREFIX = 'mirror.gcr.io/nginxinc/nginx-unprivileged'

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
 * @param {string[]} [ignorePaths] шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи
 */
export async function findDockerfilePaths(root, ignorePaths = []) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    p => {
      if (isDockerfileName(basename(p))) out.push(p)
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Витягує всі `FROM <image>` зі вмісту Dockerfile/Containerfile.
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {FromStage[]} список знайдених FROM-інструкцій
 */
export function parseFromStages(fileContent) {
  const out = []
  const lines = fileContent.split(NEWLINE_RE)
  for (const [i, line] of lines.entries()) {
    const image = getFromImageToken(line)
    if (image) out.push({ line: i + 1, image })
  }
  return out
}

const RUNTIME_IMAGES = /** @type {const} */ ([
  'mirror.gcr.io/library/alpine',
  'mirror.gcr.io/library/php',
  'mirror.gcr.io/library/python',
  'mirror.gcr.io/nginxinc/nginx-unprivileged',
  'mirror.gcr.io/openresty/openresty'
])

/** @type {RegExp} */
const DEBIAN_VIA_MIRROR_RE = /^mirror\.gcr\.io\/library\/debian:(.+)$/i

/**
 * Чи ref фінального `FROM` відповідає дозволеним у docker.mdc (multistage / runtime).
 * @param {string} lastLower ref без digest, lower case
 * @returns {boolean} true, якщо образ дозволений як фінальний runtime
 */
function isAllowedFinalRuntimeImage(lastLower) {
  if (lastLower === 'scratch' || lastLower.startsWith('scratch:')) {
    return true
  }
  const deb = lastLower.match(DEBIAN_VIA_MIRROR_RE)
  if (deb) {
    return deb[1].toLowerCase().includes('slim')
  }
  return RUNTIME_IMAGES.some(img => lastLower.startsWith(`${img}:`) || lastLower === img)
}

/**
 * Розбиває Dockerfile на stages за `FROM` (порожній масив, якщо FROM немає).
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {Array<{ from: FromStage, stageContent: string }>} stages з `FROM` і вмістом stage
 */
export function splitDockerfileStages(fileContent) {
  const stages = parseFromStages(fileContent)
  if (stages.length === 0) return []

  const lines = fileContent.split(NEWLINE_RE)
  /** @type {Array<{ from: FromStage, stageContent: string }>} */
  const out = []

  for (const [idx, from] of stages.entries()) {
    const startLineIdx = Math.max(0, from.line - 1)
    const next = stages[idx + 1]
    const endLineExclusive = next ? Math.max(0, next.line - 1) : lines.length
    out.push({ from, stageContent: lines.slice(startLineIdx, endLineExclusive).join('\n') })
  }
  return out
}

/**
 * Перевіряє базові вимоги до структури Dockerfile:
 * - multistage: мінімум 2 FROM
 * - фінальний FROM: дозволені образи в docker.mdc (alpine, scratch, debian slim, php, python, nginx, openresty, …)
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

  if (!isAllowedFinalRuntimeImage(lastLower)) {
    return `фінальний FROM має бути дозволеним runtime-образом (див. docker.mdc: multistage), зараз: ${last?.image} (рядок ${last?.line})`
  }

  return null
}

/**
 * Перевіряє вимогу "компіляція в бінарник" для bun-проєктів на backend runtime.
 *
 * Тригер:
 * - у Dockerfile є крок `bun install` (або `bun i`);
 * - фінальний FROM — `mirror.gcr.io/library/alpine:*` (тобто не nginx/openresty frontend).
 *
 * Очікування:
 * - у build stage є `bun build --compile`;
 * - у фінальному stage немає викликів `bun` (залишків build tooling).
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {string | null} повідомлення помилки або null
 */
export function getBunCompileHint(fileContent) {
  const stages = splitDockerfileStages(fileContent)
  if (stages.length === 0) return null

  const last = stages.at(-1)
  const lastImage = (last?.from.image || '').split('@')[0] || ''
  const lastLower = lastImage.toLowerCase()

  const hasBunInstall = BUN_INSTALL_RE.test(fileContent)
  const isFinalAlpine = lastLower.startsWith('mirror.gcr.io/library/alpine:')
  const isFinalFrontend =
    lastLower.startsWith(`${NGINX_UNPRIVILEGED_MIRROR_PREFIX}:`) ||
    lastLower.startsWith('mirror.gcr.io/openresty/openresty:')

  if (!hasBunInstall) return null
  if (!isFinalAlpine) return null
  if (isFinalFrontend) return null

  const hasCompile = BUN_BUILD_COMPILE_RE.test(fileContent)
  if (!hasCompile) {
    return 'є `bun install`, але немає `bun build --compile` — для backend-образу потрібно компілювати застосунок у бінарник (docker.mdc: компіляція)'
  }

  const lastStageContent = last?.stageContent || ''
  if (BUN_WORD_RE.test(lastStageContent)) {
    return 'фінальний stage не має містити Bun (RUN/CMD/ENTRYPOINT з `bun`) — залиш у runtime stage лише бінарник і runtime libs (docker.mdc: компіляція)'
  }

  return null
}

/**
 * Перевіряє, що для nginx-образів (`mirror.gcr.io/nginxinc/nginx-unprivileged`) у `FROM` вказано
 * тег `alpine-slim` (docker.mdc).
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {string | null} повідомлення помилки або null
 */
export function getNginxAlpineSlimTagHint(fileContent) {
  const prefixes = [NGINX_UNPRIVILEGED_MIRROR_PREFIX]
  for (const { line, image } of parseFromStages(fileContent)) {
    const noDigest = (image.split('@')[0] || '').trim()
    const d = noDigest.toLowerCase()
    const prefix = prefixes.find(p => d.startsWith(`${p}:`) || d === p)
    if (prefix) {
      if (d === prefix) {
        return `рядок ${line}: \`FROM ${prefix}\` має явний тег \`alpine-slim\` (docker.mdc: мінімальні образи), зараз без тега (типово latest)`
      }
      const tag = noDigest.slice(prefix.length + 1)
      if (tag.toLowerCase() !== 'alpine-slim') {
        return `рядок ${line}: для nginx потрібен тег \`alpine-slim\` (docker.mdc: мінімальні образи), зараз: \`${tag}\``
      }
    }
  }
  return null
}

/**
 * Перевіряє вимогу "non-root" у фінальному runtime stage (docker.mdc).
 *
 * Очікування:
 * - у фінальному stage має бути інструкція `USER <name|uid>`;
 * - користувач не має бути `root` і не має бути `0`.
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {string | null} повідомлення помилки або null
 */
export function getNonRootRuntimeHint(fileContent) {
  const stages = splitDockerfileStages(fileContent)
  if (stages.length === 0) return null

  const last = stages.at(-1)
  const lastImage = (last?.from.image || '').split('@')[0] || ''
  const lastLower = lastImage.toLowerCase()
  const lastStageContent = last?.stageContent || ''

  /** @type {string | null} */
  let lastUserToken = null
  for (const line of lastStageContent.split(NEWLINE_RE)) {
    const m = line.match(USER_LINE_RE)
    if (m) {
      lastUserToken = (m[1] || '').replaceAll('"', '').replaceAll("'", '')
    }
  }

  if (!lastUserToken) {
    // nginx-unprivileged вже запускається від uid=101 (nginx) без явного USER у Dockerfile
    if (lastLower.startsWith(`${NGINX_UNPRIVILEGED_MIRROR_PREFIX}:`)) return null
    return 'у фінальному stage має бути `USER <non-root>` (наприклад `USER app`) — принцип non-root (docker.mdc: не превілейований образ)'
  }

  const normalized = lastUserToken.trim().toLowerCase()
  if (normalized === 'root' || normalized === '0') {
    return `фінальний stage має запускатися не від root: зараз \`USER ${lastUserToken}\` (docker.mdc: не превілейований образ)`
  }

  return null
}

/**
 * Перевіряє Dockerfile / Containerfile через hadolint (docker.mdc).
 * @returns {Promise<number>} 0 — все OK, 1 — є зауваження або помилка запуску
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass } = reporter

  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  const files = await findDockerfilePaths(root, ignorePaths)

  if (files.length === 0) {
    pass('Немає Dockerfile / Containerfile — перевірку hadolint пропущено')
    return reporter.getExitCode()
  }

  pass(`Знайдено файлів для hadolint: ${files.length}`)

  for (const abs of files) {
    await checkDockerfile(reporter, root, abs)
  }

  return reporter.getExitCode()
}

/**
 * Перевіряє один Dockerfile/Containerfile: mirror.gcr.io, multistage/runtime, compile/non-root/nginx tag і hadolint.
 * @param {ReturnType<typeof createCheckReporter>} reporter репортер перевірок
 * @param {string} root корінь репозиторію
 * @param {string} abs абсолютний шлях до Dockerfile/Containerfile
 * @returns {Promise<void>}
 */
async function checkDockerfile(reporter, root, abs) {
  const { pass, fail } = reporter
  const rel = posixRel(root, abs) || basename(abs)
  const content = await readFile(abs, 'utf8')

  const hint = getMirrorGcrHint(content)
  if (hint) fail(`${rel} (mirror.gcr.io): ${hint}`)

  const multistageHint = getMultistageAndRuntimeHint(content)
  if (multistageHint) fail(`${rel} (multistage): ${multistageHint}`)

  const compileHint = getBunCompileHint(content)
  if (compileHint) fail(`${rel} (compile): ${compileHint}`)

  const nonRootHint = getNonRootRuntimeHint(content)
  if (nonRootHint) fail(`${rel} (non-root): ${nonRootHint}`)

  const nginxSlimHint = getNginxAlpineSlimTagHint(content)
  if (nginxSlimHint) fail(`${rel} (nginx tag): ${nginxSlimHint}`)

  const { ok, stdout, stderr, via } = lintDockerfileWithHadolint(root, abs)
  const tail = (stdout + stderr).trim()
  if (ok) {
    pass(`${rel} (${via})`)
  } else {
    const detail = tail ? `:\n${tail}` : ''
    fail(`${rel} (${via})${detail}`)
  }
}
