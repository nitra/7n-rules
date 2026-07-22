/** @see ./docs/lint.md */
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { getMirrorGcrHint, getFromImageToken } from '../lib/docker-mirror.mjs'
import { getNativeAddonDeps, getNativeAddonNoCompileHint } from '../lib/docker-native-addon.mjs'
import { getNginxUnprivilegedUserHint } from '../lib/docker-nginx-user.mjs'
import { lintDockerfileWithHadolint, posixRel } from '../lib/docker-hadolint.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

const NEWLINE_RE = /\r?\n/
const BUN_INSTALL_RE = /\bbun\s+(?:install|i)\b/iu
const BUN_BUILD_COMPILE_RE = /\bbun\s+build\b[^\n]*\s--compile\b/iu
const BUN_WORD_RE = /\bbun\b/iu
const USER_LINE_RE = /^\s*USER\s+([^\s#]+)/iu
const BUN_NO_COMPILE_MARKER_RE = /^#\s*n-rules:bun-no-compile:(.*)$/iu

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
  return Boolean(n.startsWith('dockerfile.') || n.startsWith('containerfile.'))
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

/** Bun-рантайм як фінальний stage — легітимний лише за наявності нативного .node-аддона або `n-rules:bun-no-compile`-маркера (див. docker.mdc). */
const BUN_RUNTIME_IMAGE = 'mirror.gcr.io/oven/bun'

/**
 * Явний opt-in консюмера: сервіс не можна пакувати через `bun build --compile` з причини, яку
 * checker не може вивести механічно (динамічний `import()` рантайм-конфігу тощо — на відміну
 * від нативних `.node`-аддонів, які виявляються з `package.json#dependencies`). Маркер —
 * коментар-рядок `# n-rules:bun-no-compile: <причина>` будь-де у файлі; той самий канон, що й для
 * native-addon: ship `node_modules` + `bun <entry>` на `mirror.gcr.io/oven/bun:*`.
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {boolean} true, якщо маркер присутній із непорожньою причиною
 */
export function hasBunNoCompileMarker(fileContent) {
  return fileContent.split(NEWLINE_RE).some(line => {
    const m = line.trim().match(BUN_NO_COMPILE_MARKER_RE)
    return Boolean(m && m[1].trim().length > 0)
  })
}

/**
 * Чи ref фінального `FROM` відповідає дозволеним у docker.mdc (multistage / runtime).
 * @param {string} lastLower ref без digest, lower case
 * @param {boolean} [allowBunRuntime] чи легітимний bun-рантайм як фінальний stage (нативний аддон або `n-rules:bun-no-compile`-маркер)
 * @returns {boolean} true, якщо образ дозволений як фінальний runtime
 */
function isAllowedFinalRuntimeImage(lastLower, allowBunRuntime = false) {
  if (lastLower === 'scratch' || lastLower.startsWith('scratch:')) {
    return true
  }
  // Канон — ship node_modules + `bun <entry>`, тож фінальний stage на mirror.gcr.io/oven/bun:*
  // легітимний, коли compile неможливий (native-addon: docker-native-addon.mjs, або явний
  // n-rules:bun-no-compile-маркер: hasBunNoCompileMarker).
  if (allowBunRuntime && (lastLower === BUN_RUNTIME_IMAGE || lastLower.startsWith(`${BUN_RUNTIME_IMAGE}:`))) {
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
 * - фінальний FROM: дозволені образи в docker.mdc (alpine, scratch, debian slim, php, python, nginx, openresty, …);
 *   для проєктів із нативним .node-аддоном або `n-rules:bun-no-compile`-маркером додатково дозволено
 *   mirror.gcr.io/oven/bun:* (bun-рантайм)
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @param {{ hasNativeAddon?: boolean }} [opts] опції: hasNativeAddon — є нативний .node-аддон (sharp/@img/argon2)
 * @returns {string | null} повідомлення помилки або null
 */
export function getMultistageAndRuntimeHint(fileContent, { hasNativeAddon = false } = {}) {
  const stages = parseFromStages(fileContent)
  if (stages.length === 0) return null

  if (stages.length < 2) {
    return 'має бути multistage build: мінімум 2 інструкції FROM (build stage + runtime stage)'
  }

  const last = stages.at(-1)
  const lastImage = (last?.image || '').split('@', 1)[0] || ''
  const lastLower = lastImage.toLowerCase()
  const allowBunRuntime = hasNativeAddon || hasBunNoCompileMarker(fileContent)

  if (!isAllowedFinalRuntimeImage(lastLower, allowBunRuntime)) {
    return `фінальний FROM має бути дозволеним runtime-образом (див. docker.mdc: multistage), зараз: ${last?.image} (рядок ${last?.line})`
  }

  return null
}

/**
 * Перевіряє вимогу "компіляція в бінарник" для bun-проєктів на backend runtime.
 *
 * Тригер:
 * - у Dockerfile є крок `bun install` (або `bun i`);
 * - фінальний FROM — `mirror.gcr.io/library/alpine:*` (тобто не nginx/openresty frontend);
 * - немає `n-rules:bun-no-compile`-маркера (явний opt-in консюмера — compile неможливий з причини поза
 *   виявними класами на кшталт нативних аддонів, напр. динамічний `import()` рантайм-конфігу).
 *
 * Очікування:
 * - у build stage є `bun build --compile`;
 * - у фінальному stage немає викликів `bun` (залишків build tooling).
 * @param {string} fileContent вміст Dockerfile/Containerfile
 * @returns {string | null} повідомлення помилки або null
 */
export function getBunCompileHint(fileContent) {
  if (hasBunNoCompileMarker(fileContent)) return null

  const stages = splitDockerfileStages(fileContent)
  if (stages.length === 0) return null

  const last = stages.at(-1)
  const lastImage = (last?.from.image || '').split('@', 1)[0] || ''
  const lastLower = lastImage.toLowerCase()

  const hasBunInstall = BUN_INSTALL_RE.test(fileContent)
  if (!hasBunInstall) return null

  const isFinalAlpine = lastLower.startsWith('mirror.gcr.io/library/alpine:')
  if (!isFinalAlpine) return null

  const isFinalFrontend =
    lastLower.startsWith(`${NGINX_UNPRIVILEGED_MIRROR_PREFIX}:`) ||
    lastLower.startsWith('mirror.gcr.io/openresty/openresty:')
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
    const noDigest = (image.split('@', 1)[0] || '').trim()
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
  const lastImage = (last?.from.image || '').split('@', 1)[0] || ''
  const lastLower = lastImage.toLowerCase()
  const lastStageContent = last?.stageContent || ''

  /** @type {string | null} */
  let lastUserToken = null
  for (const line of lastStageContent.split(NEWLINE_RE)) {
    const m = line.match(USER_LINE_RE)
    if (m) {
      lastUserToken = (m[1] || '').replaceAll(/["']/g, '')
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
 * Detector docker/lint: Dockerfile/Containerfile — mirror/multistage/runtime/non-root + hadolint.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (cwd, перелік файлів тощо).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} Результат лінту з переліком порушень.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const root = ctx.cwd
  const ignorePaths = await loadCursorIgnorePaths(root)
  const files = await findDockerfilePaths(root, ignorePaths)

  for (const abs of files) {
    await checkDockerfile(reporter, root, abs)
  }

  return reporter.result()
}

/**
 * Читає `dependencies` найближчого `package.json` (від каталогу Dockerfile вгору до кореня репо).
 * Build-контекст Dockerfile — зазвичай його ж каталог, тож беремо найбільш специфічний package.json.
 * @param {string} abs абсолютний шлях до Dockerfile/Containerfile
 * @param {string} root корінь репозиторію
 * @returns {Promise<Record<string, unknown>>} dependencies або порожній об'єкт
 */
async function readNearestDependencies(abs, root) {
  let dir = dirname(abs)
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      const deps = pkg?.dependencies
      if (deps && typeof deps === 'object' && !Array.isArray(deps)) return deps
      return {}
    } catch {
      /* немає package.json у цьому каталозі — піднімаємось вище */
    }
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return {}
}

/**
 * Перевіряє один Dockerfile/Containerfile: mirror.gcr.io, multistage/runtime, compile/non-root/nginx tag і hadolint.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер violations
 * @param {string} root корінь репозиторію
 * @param {string} abs абсолютний шлях до Dockerfile/Containerfile
 * @returns {Promise<void>}
 */
async function checkDockerfile(reporter, root, abs) {
  const { fail } = reporter
  const rel = posixRel(root, abs) || basename(abs)
  const content = await readFile(abs, 'utf8')

  const nativeAddons = getNativeAddonDeps(await readNearestDependencies(abs, root))
  const hasNativeAddon = nativeAddons.length > 0

  const hint = getMirrorGcrHint(content)
  if (hint) fail(`${rel} (mirror.gcr.io): ${hint}`)

  const multistageHint = getMultistageAndRuntimeHint(content, { hasNativeAddon })
  if (multistageHint) fail(`${rel} (multistage): ${multistageHint}`)

  // Нативні .node-аддони (sharp/@img/argon2) керують окремо: compile заборонено (бінарник падає
  // в рантаймі), канон — node_modules + `bun <entry>`. Генеричне compile-правило для них не діє.
  if (hasNativeAddon) {
    const nativeAddonHint = getNativeAddonNoCompileHint(content, nativeAddons)
    if (nativeAddonHint) fail(`${rel} (native-addon): ${nativeAddonHint}`)
  } else {
    const compileHint = getBunCompileHint(content)
    if (compileHint) fail(`${rel} (compile): ${compileHint}`)
  }

  const nonRootHint = getNonRootRuntimeHint(content)
  if (nonRootHint) fail(`${rel} (non-root): ${nonRootHint}`)

  const nginxSlimHint = getNginxAlpineSlimTagHint(content)
  if (nginxSlimHint) fail(`${rel} (nginx tag): ${nginxSlimHint}`)

  const nginxUserHint = getNginxUnprivilegedUserHint(content)
  if (nginxUserHint) fail(`${rel} (nginx non-root): ${nginxUserHint}`)

  const { ok, stdout, stderr, via } = await lintDockerfileWithHadolint(root, abs)
  const tail = (stdout + stderr).trim()
  if (!ok) {
    const detail = tail ? `:\n${tail}` : ''
    fail(`${rel} (${via})${detail}`, { reason: 'hadolint', file: rel })
  }
}
