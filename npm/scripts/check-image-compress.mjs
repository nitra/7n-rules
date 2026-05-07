/**
 * Перевіряє відповідність репозиторію правилу `image-compress.mdc`: канонічний скрипт
 * `lint-image` для оптимізації raster/SVG через `@nitra/minify-image` ≥ 3.2.0 (локально).
 *
 * Очікування:
 * - у кореневому `package.json` є скрипт `lint-image`, який викликає `npx @nitra/minify-image`
 *   з обовʼязковими `--src=.` і `--write`. Прапорець `--avif` у `lint-image` заборонений —
 *   AVIF-генерацію виконує окреме правило `image-avif` (інакше `bun run lint` плодив би `.avif`
 *   для зображень, що ніде не вживаються);
 * - якщо в `package.json` є агрегований скрипт `lint`, він викликає `bun run lint-image`
 *   (симетрично до `lint-text`, `lint-js`, `lint-ga`);
 * - `@nitra/minify-image` не оголошений у `dependencies`/`devDependencies` —
 *   CLI запускається лише через `npx` (як `markdownlint-cli2` у `text.mdc`);
 * - `.n-minify-image.tsv` (committed source of truth з sha1/originalSize/size) НЕ
 *   в `.gitignore` — він має бути в git. Локальний mtime-кеш у
 *   `node_modules/.cache/@nitra/minify-image/mtime.tsv` авто-gitignored через `node_modules/`,
 *   окремої перевірки не вимагає;
 * - застарілий `.minify-image-cache.tsv` (з версій < 3.2) видалений з кореня — інакше
 *   проєкт лишається у напівпереміщеному стані.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'

/** Імʼя CLI-пакета: рядок у `lint-image` і заборонений у залежностях. */
const MINIFY_PACKAGE_NAME = '@nitra/minify-image'

/** Імʼя committed-кешу (sha1 + originalSize + size) у `@nitra/minify-image` ≥ 3.2.0. */
const HASH_CACHE_FILENAME = '.n-minify-image.tsv'

/** Імʼя застарілого 4-колонкового кешу (`@nitra/minify-image` < 3.2). Має бути видалений після міграції. */
const LEGACY_CACHE_FILENAME = '.minify-image-cache.tsv'

/**
 * Перевіряє скрипт `lint-image` у `package.json`.
 *
 * Має містити виклик `npx @nitra/minify-image` з обовʼязковими прапорцями `--src=.`
 * і `--write` (авто-оптимізація на місці). Прапорець `--avif` у `lint-image`
 * заборонений — AVIF-генерацію виконує `check image-avif`, інакше `bun run lint` плодить
 * `.avif` для зображень, що ніде не вживаються.
 * @param {string|undefined} lintImage значення `scripts['lint-image']`
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void}
 */
function checkLintImageScript(lintImage, pass, fail) {
  const canonical = `npx ${MINIFY_PACKAGE_NAME} --src=. --write`
  if (typeof lintImage !== 'string' || !lintImage.trim()) {
    fail(`package.json: додай скрипт "lint-image" з \`${canonical}\` (image-compress.mdc)`)
    return
  }
  if (!lintImage.includes(`npx ${MINIFY_PACKAGE_NAME}`)) {
    fail(`package.json: lint-image має викликати \`npx ${MINIFY_PACKAGE_NAME}\` (image-compress.mdc)`)
    return
  }
  /** @type {{ flag: string, variants: string[], hint: string }[]} */
  const requiredFlags = [
    { flag: '--src=.', variants: ['--src=.', '--src .'], hint: '`--src=.`' },
    { flag: '--write', variants: ['--write'], hint: '`--write` (авто-оптимізація на місці)' }
  ]
  const missing = requiredFlags.filter(f => !f.variants.some(v => lintImage.includes(v)))
  if (missing.length > 0) {
    fail(
      `package.json: lint-image має містити ${missing.map(f => f.hint).join(', ')} — канонічний виклик: \`${canonical}\` (image-compress.mdc)`
    )
    return
  }
  if (lintImage.includes('--avif')) {
    fail(
      `package.json: прибери \`--avif\` з lint-image — AVIF-генерацію виконує \`npx @nitra/cursor check image-avif\` (image-compress.mdc). Канонічний виклик: \`${canonical}\``
    )
    return
  }
  pass(`package.json: lint-image викликає \`${canonical}\``)
}

/**
 * Перевіряє, що агрегований `lint` (якщо є) кличе `bun run lint-image` —
 * симетрично до `lint-text`, `lint-js`, `lint-ga`.
 * @param {string|undefined} lintAggregate значення `scripts.lint`
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void}
 */
function checkLintAggregateIncludesImage(lintAggregate, pass, fail) {
  if (typeof lintAggregate !== 'string' || !lintAggregate.trim()) {
    return
  }
  if (lintAggregate.includes('bun run lint-image')) {
    pass('package.json: агрегований `lint` викликає `bun run lint-image`')
  } else {
    fail(
      'package.json: у `lint` додай `bun run lint-image` (image-compress.mdc, симетрично до lint-text / lint-js / lint-ga)'
    )
  }
}

/**
 * Забороняє `@nitra/minify-image` у `dependencies` чи `devDependencies` —
 * CLI завжди запускається через `npx` (як `markdownlint-cli2` у `text.mdc`).
 * @param {{ dependencies?: Record<string, unknown>, devDependencies?: Record<string, unknown> }} pkg розібраний package.json
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void}
 */
function checkMinifyImageNotInDeps(pkg, pass, fail) {
  const inDeps = Boolean(pkg.dependencies && MINIFY_PACKAGE_NAME in pkg.dependencies)
  const inDevDeps = Boolean(pkg.devDependencies && MINIFY_PACKAGE_NAME in pkg.devDependencies)
  if (inDeps || inDevDeps) {
    fail(
      `package.json: ${MINIFY_PACKAGE_NAME} не додавай у dependencies/devDependencies — лише через \`npx\` (image-compress.mdc)`
    )
  } else {
    pass(`package.json: ${MINIFY_PACKAGE_NAME} не оголошено в dependencies/devDependencies`)
  }
}

/**
 * Зчитує всі змістовні рядки `.gitignore` (без коментарів і порожніх). Якщо файла нема — `null`.
 * @returns {Promise<string[] | null>} список trim-нутих рядків або `null`
 */
async function readGitignoreLines() {
  if (!existsSync('.gitignore')) return null
  const raw = await readFile('.gitignore', 'utf8')
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
}

/**
 * Перевіряє, що `.n-minify-image.tsv` НЕ в `.gitignore` — він має бути в git
 * (split-cache 3.2.0: source of truth для slow-path і lifetime savings).
 *
 * Сам факт існування файла НЕ вимагається — на свіжому проєкті без обробки
 * зображень його ще нема, це нормально.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>}
 */
async function checkHashCacheNotIgnored(pass, fail) {
  const lines = await readGitignoreLines()
  if (lines && lines.includes(HASH_CACHE_FILENAME)) {
    fail(
      `.gitignore: прибери рядок \`${HASH_CACHE_FILENAME}\` — це закомічений source of truth split-cache 3.2.0 (image-compress.mdc)`
    )
  } else {
    pass(`${HASH_CACHE_FILENAME} не в .gitignore (має бути в git)`)
  }
}

/**
 * Перевіряє, що застарілий `.minify-image-cache.tsv` (з версій < 3.2) видалений
 * з кореня. Якщо лежить — користувач не завершив міграцію на split-cache, що
 * залишає файл як орфана у git-історії.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>}
 */
async function checkLegacyCacheRemoved(pass, fail) {
  if (existsSync(LEGACY_CACHE_FILENAME)) {
    fail(
      `${LEGACY_CACHE_FILENAME} застарілий (split-cache 3.2.0) — видали: ` +
        `\`git rm --cached ${LEGACY_CACHE_FILENAME} 2>/dev/null || true && rm -f ${LEGACY_CACHE_FILENAME}\` ` +
        '(також прибери відповідний рядок з .gitignore, якщо є)'
    )
    return
  }
  const lines = await readGitignoreLines()
  if (lines && lines.includes(LEGACY_CACHE_FILENAME)) {
    fail(`.gitignore: прибери застарілий рядок \`${LEGACY_CACHE_FILENAME}\` — split-cache 3.2.0 його не використовує`)
    return
  }
  pass(`${LEGACY_CACHE_FILENAME} відсутній (міграція на split-cache завершена)`)
}

/**
 * Перевіряє кореневий `package.json`: скрипти, заборонені залежності, агрегований `lint`.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<boolean>} `true`, якщо `package.json` знайдено й оброблено; `false` — нема
 */
async function checkPackageJsonImage(pass, fail) {
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (image-compress.mdc)')
    return false
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const scripts = /** @type {Record<string, unknown>} */ (pkg.scripts || {})
  checkLintImageScript(typeof scripts['lint-image'] === 'string' ? scripts['lint-image'] : undefined, pass, fail)
  checkLintAggregateIncludesImage(typeof scripts.lint === 'string' ? scripts.lint : undefined, pass, fail)
  checkMinifyImageNotInDeps(pkg, pass, fail)
  return true
}

/**
 * Перевіряє відповідність проєкту правилу `image-compress.mdc`: канонічний `lint-image`
 * (через `npx @nitra/minify-image --src=. --write`, без `--avif`!), агрегований `lint`,
 * `@nitra/minify-image` не у залежностях, `.n-minify-image.tsv` НЕ в `.gitignore`,
 * застарілий `.minify-image-cache.tsv` видалений. CI-workflow для image не вимагається —
 * лінт зображень виконується лише локально.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const pkgFound = await checkPackageJsonImage(pass, fail)
  if (pkgFound) {
    await checkHashCacheNotIgnored(pass, fail)
    await checkLegacyCacheRemoved(pass, fail)
  }

  return reporter.getExitCode()
}
