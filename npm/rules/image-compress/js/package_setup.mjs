/**
 * Перевіряє вимоги правила `image-compress.mdc` для оптимізації raster/SVG через
 * `@nitra/minify-image` ≥ 3.2.0 (локально).
 *
 * **Що тут лишилося** (FS / cross-file):
 *  - наявність `package.json` у корені;
 *  - `.n-minify-image.tsv` (committed source of truth з sha1/originalSize/size) НЕ
 *    в `.gitignore` — він має бути в git;
 *  - застарілий `.minify-image-cache.tsv` (з версій < 3.2) видалений з кореня та
 *    з `.gitignore`.
 *
 * **Що покрила Rego** (`npx \@nitra/cursor fix`,
 * `npm/rules/image-compress/policy/package_json/`):
 *  - `scripts.lint-image` викликає `npx \@nitra/minify-image --src=. --write`
 *    без `--avif` (AVIF — окреме правило `image-avif`);
 *  - агрегований `lint` (якщо є) містить `bun run lint-image`;
 *  - `@nitra/minify-image` НЕ у `dependencies` / `devDependencies` (через `npx`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/** Імʼя committed-кешу (sha1 + originalSize + size) у `@nitra/minify-image` ≥ 3.2.0. */
const HASH_CACHE_FILENAME = '.n-minify-image.tsv'

/** Імʼя застарілого 4-колонкового кешу (`@nitra/minify-image` < 3.2). Має бути видалений після міграції. */
const LEGACY_CACHE_FILENAME = '.minify-image-cache.tsv'

/**
 * Зчитує всі змістовні рядки `.gitignore` (без коментарів і порожніх). Якщо файла нема — `null`.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<string[] | null>} список trim-нутих рядків або `null`
 */
async function readGitignoreLines(cwd) {
  const gitignorePath = join(cwd, '.gitignore')
  if (!existsSync(gitignorePath)) return null
  const raw = await readFile(gitignorePath, 'utf8')
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
 * @param {string} cwd корінь репозиторію
 */
async function checkHashCacheNotIgnored(pass, fail, cwd) {
  const lines = await readGitignoreLines(cwd)
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
 * @param {string} cwd корінь репозиторію
 */
async function checkLegacyCacheRemoved(pass, fail, cwd) {
  if (existsSync(join(cwd, LEGACY_CACHE_FILENAME))) {
    fail(
      `${LEGACY_CACHE_FILENAME} застарілий (split-cache 3.2.0) — видали: ` +
        `\`git rm --cached ${LEGACY_CACHE_FILENAME} 2>/dev/null || true && rm -f ${LEGACY_CACHE_FILENAME}\` ` +
        '(також прибери відповідний рядок з .gitignore, якщо є)'
    )
    return
  }
  const lines = await readGitignoreLines(cwd)
  if (lines && lines.includes(LEGACY_CACHE_FILENAME)) {
    fail(`.gitignore: прибери застарілий рядок \`${LEGACY_CACHE_FILENAME}\` — split-cache 3.2.0 його не використовує`)
    return
  }
  pass(`${LEGACY_CACHE_FILENAME} відсутній (міграція на split-cache завершена)`)
}

/**
 * Перевіряє відповідність проєкту правилу `image-compress.mdc`: `.n-minify-image.tsv` НЕ
 * в `.gitignore`, застарілий `.minify-image-cache.tsv` видалений. CI-workflow для image
 * не вимагається — лінт зображень виконується лише локально.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (!existsSync(join(cwd, 'package.json'))) {
    fail('package.json не знайдено в корені — додай (image-compress.mdc)')
    return reporter.getExitCode()
  }
  pass('package.json є (структуру перевіряє npx @nitra/cursor fix → image_compress.package_json)')

  await checkHashCacheNotIgnored(pass, fail, cwd)
  await checkLegacyCacheRemoved(pass, fail, cwd)

  return reporter.getExitCode()
}
