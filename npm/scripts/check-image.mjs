/**
 * Перевіряє відповідність репозиторію правилу image.mdc для оптимізації зображень
 * через `@nitra/minify-image` (локально — у CI лінт зображень не запускається).
 *
 * Очікування:
 * - у кореневому `package.json` є скрипт `lint-image`, який викликає `npx @nitra/minify-image`
 *   з обовʼязковими `--src=.`, `--write` і `--avif` (авто-оптимізація з AVIF-двійниками);
 * - якщо в `package.json` є агрегований скрипт `lint`, він викликає `bun run lint-image`
 *   (симетрично до `lint-text`, `lint-js`, `lint-ga`);
 * - `@nitra/minify-image` не оголошений у `dependencies`/`devDependencies` —
 *   CLI запускається лише через `npx` (як `markdownlint-cli2` у `text.mdc`);
 * - `.minify-image-cache.tsv` ігнорується через `.gitignore`,
 *   або (рідше) явно перерахований у `files` пакета npm.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'

/** Імʼя CLI-пакета: рядок у `lint-image` і заборонений у залежностях. */
const MINIFY_PACKAGE_NAME = '@nitra/minify-image'

/** Імʼя кеш-файлу, який CLI створює у режимі `--write`. */
const CACHE_FILENAME = '.minify-image-cache.tsv'

/**
 * Перевіряє скрипт `lint-image` у `package.json`.
 *
 * Має містити виклик `npx @nitra/minify-image` з обовʼязковими прапорцями `--src=.`,
 * `--write` (авто-оптимізація на місці) і `--avif` (AVIF-двійники для PNG/JPEG/GIF).
 * Без `--write`/`--avif` лінт лише оцінює економію — для проєктних коммітів цього мало.
 * @param {string|undefined} lintImage значення `scripts['lint-image']`
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void}
 */
function checkLintImageScript(lintImage, pass, fail) {
  const canonical = `npx ${MINIFY_PACKAGE_NAME} --src=. --write --avif`
  if (typeof lintImage !== 'string' || !lintImage.trim()) {
    fail(`package.json: додай скрипт "lint-image" з \`${canonical}\` (image.mdc)`)
    return
  }
  if (!lintImage.includes(`npx ${MINIFY_PACKAGE_NAME}`)) {
    fail(`package.json: lint-image має викликати \`npx ${MINIFY_PACKAGE_NAME}\` (image.mdc)`)
    return
  }
  /** @type {{ flag: string, variants: string[], hint: string }[]} */
  const requiredFlags = [
    { flag: '--src=.', variants: ['--src=.', '--src .'], hint: '`--src=.`' },
    { flag: '--write', variants: ['--write'], hint: '`--write` (авто-оптимізація на місці)' },
    { flag: '--avif', variants: ['--avif'], hint: '`--avif` (AVIF-двійники для PNG/JPEG/GIF)' }
  ]
  const missing = requiredFlags.filter(f => !f.variants.some(v => lintImage.includes(v)))
  if (missing.length > 0) {
    fail(
      `package.json: lint-image має містити ${missing.map(f => f.hint).join(', ')} — канонічний виклик: \`${canonical}\` (image.mdc)`
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
    fail('package.json: у `lint` додай `bun run lint-image` (image.mdc, симетрично до lint-text / lint-js / lint-ga)')
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
      `package.json: ${MINIFY_PACKAGE_NAME} не додавай у dependencies/devDependencies — лише через \`npx\` (image.mdc)`
    )
  } else {
    pass(`package.json: ${MINIFY_PACKAGE_NAME} не оголошено в dependencies/devDependencies`)
  }
}

/**
 * Перевіряє `.minify-image-cache.tsv`: має бути або у `.gitignore`,
 * або явно у `files`-листі пакета (рідкісний кейс для open-source npm-пакетів).
 * @param {{ files?: unknown }} pkg розібраний package.json (для перевірки `files`)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>}
 */
async function checkCacheIgnoredOrPublished(pkg, pass, fail) {
  if (existsSync('.gitignore')) {
    const raw = await readFile('.gitignore', 'utf8')
    const lines = raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'))
    if (lines.includes(CACHE_FILENAME)) {
      pass(`.gitignore містить ${CACHE_FILENAME}`)
      return
    }
  }
  if (Array.isArray(pkg.files) && pkg.files.some(f => typeof f === 'string' && f.includes(CACHE_FILENAME))) {
    pass(`package.json: ${CACHE_FILENAME} перерахований у \`files\` (комітований кеш)`)
    return
  }
  fail(
    `.gitignore: додай рядок \`${CACHE_FILENAME}\` (або явно перерахуй у \`files\` package.json) — image.mdc`
  )
}

/**
 * Перевіряє кореневий `package.json`: скрипти, заборонені залежності, агрегований `lint`.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<{ pkg: Record<string, unknown> } | null>} розібраний package.json або `null` якщо немає
 */
async function checkPackageJsonImage(pass, fail) {
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (image.mdc)')
    return null
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const scripts = /** @type {Record<string, unknown>} */ (pkg.scripts || {})
  checkLintImageScript(typeof scripts['lint-image'] === 'string' ? scripts['lint-image'] : undefined, pass, fail)
  checkLintAggregateIncludesImage(typeof scripts.lint === 'string' ? scripts.lint : undefined, pass, fail)
  checkMinifyImageNotInDeps(pkg, pass, fail)
  return { pkg }
}

/**
 * Перевіряє відповідність проєкту правилам `image.mdc`:
 * `lint-image` через `npx @nitra/minify-image --src=.`, агрегований `lint`,
 * `.minify-image-cache.tsv` у `.gitignore`. CI-workflow для image не вимагається —
 * лінт зображень виконується лише локально.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const pkgResult = await checkPackageJsonImage(pass, fail)
  if (pkgResult) {
    await checkCacheIgnoredOrPublished(pkgResult.pkg, pass, fail)
  }

  return reporter.getExitCode()
}
