/**
 * Перевіряє відповідність репозиторію правилу image.mdc для оптимізації зображень
 * через `@nitra/minify-image` ≥ 3.2.0 (локально — у CI лінт зображень не запускається).
 *
 * Очікування:
 * - у кореневому `package.json` є скрипт `lint-image`, який викликає `npx @nitra/minify-image`
 *   з обовʼязковими `--src=.`, `--write` і `--avif` (авто-оптимізація з AVIF-двійниками);
 * - якщо в `package.json` є агрегований скрипт `lint`, він викликає `bun run lint-image`
 *   (симетрично до `lint-text`, `lint-js`, `lint-ga`);
 * - `@nitra/minify-image` не оголошений у `dependencies`/`devDependencies` —
 *   CLI запускається лише через `npx` (як `markdownlint-cli2` у `text.mdc`);
 * - `.n-minify-image.tsv` (committed source of truth з sha1/originalSize/size) НЕ
 *   в `.gitignore` — він має бути в git. Локальний mtime-кеш у
 *   `node_modules/.cache/@nitra/minify-image/mtime.tsv` авто-gitignored через `node_modules/`,
 *   окремої перевірки не вимагає;
 * - застарілий `.minify-image-cache.tsv` (з версій < 3.2) видалений з кореня — інакше
 *   проєкт лишається у напівпереміщеному стані;
 * - у `.vue` файлах raster-імпорти (`.png` / `.jpg` / `.jpeg` / `.gif`) посилаються на
 *   AVIF-двійники (`...png.avif` тощо), оскільки `--avif` гарантує їх наявність поряд із
 *   оригіналами. Можна вимкнути на рівні воркспейс-пакета через `"@nitra/minify-image": {
 *   "disable-avif": true }` у його `package.json`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from './utils/load-cursor-config.mjs'
import { walkDir } from './utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from './utils/workspaces.mjs'

/** Імʼя CLI-пакета: рядок у `lint-image` і заборонений у залежностях. */
const MINIFY_PACKAGE_NAME = '@nitra/minify-image'

/** Імʼя committed-кешу (sha1 + originalSize + size) у `@nitra/minify-image` ≥ 3.2.0. */
const HASH_CACHE_FILENAME = '.n-minify-image.tsv'

/** Імʼя застарілого 4-колонкового кешу (`@nitra/minify-image` < 3.2). Має бути видалений після міграції. */
const LEGACY_CACHE_FILENAME = '.minify-image-cache.tsv'

/** Поле в `package.json` для конфігу @nitra/minify-image (наприклад, `disable-avif`). */
const PKG_CONFIG_FIELD = '@nitra/minify-image'

/**
 * Регексп для імпортів raster-зображень у `.vue` файлах.
 * Захоплює `import name from '...ext'` (як default, так і type-only форми не потрібні —
 * type-imports asset-ів не існує). Захоплюється повний шлях у групі 1.
 */
const VUE_RASTER_IMPORT_RE = /import\s+\w[\w$]*\s+from\s+['"]([^'"\n]+\.(?:png|jpe?g|gif))['"]/giu

/**
 * Регексп для прямих посилань на raster-зображення у HTML-атрибуті `src="..."` шаблона `.vue`
 * (наприклад `<img src="./hero.png" />`). Vite перетворює такі шляхи на asset-імпорти на етапі
 * збірки, тож для них теж діє вимога вживати AVIF-двійник.
 *
 * Лукбехайнд `(?<![:\-_.])` виключає реактивне `:src="..."` (там JS-вираз — змінна або виклик,
 * перевіряється через імпорт), `data-src="..."` і `obj.src=...` у `<script>`.
 */
const VUE_RASTER_STATIC_SRC_RE = /(?<![:\-_.])\bsrc\s*=\s*['"]([^'"\s]+\.(?:png|jpe?g|gif))['"]/giu

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
      `.gitignore: прибери рядок \`${HASH_CACHE_FILENAME}\` — це закомічений source of truth split-cache 3.2.0 (image.mdc)`
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
 * Чи у `package.json` пакета вимкнено avif-перевірку Vue-імпортів.
 * Очікувана форма: `"@nitra/minify-image": { "disable-avif": true }`.
 * @param {Record<string, unknown>} pkg розібраний package.json пакета
 * @returns {boolean} true, якщо опт-аут активовано
 */
function packageHasAvifDisabled(pkg) {
  const cfg = pkg[PKG_CONFIG_FIELD]
  return Boolean(
    cfg && typeof cfg === 'object' && /** @type {Record<string, unknown>} */ (cfg)['disable-avif'] === true
  )
}

/**
 * Сканує `.vue` файли одного workspace-пакета на raster-імпорти, що ще не використовують `.avif`.
 *
 * Файли, що належать іншим workspace-пакетам, ігноруються — кожен пакет перевіряється рівно
 * один раз (інакше при обході кореня `.` ми б повторно зайшли в `demo/` і подвоїли звіти).
 * @param {string} packageRoot відносний шлях до кореня пакета (наприклад `'.'` або `'demo'`)
 * @param {string[]} otherRootsAbs абсолютні шляхи інших workspace-коренів — їх піддерева пропускаємо
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>} резолвиться по завершенню перевірки одного пакета
 */
async function checkVueAvifImportsInPackage(packageRoot, otherRootsAbs, ignorePaths, pass, fail) {
  const absRoot = join(process.cwd(), packageRoot)
  const label = packageRoot === '.' ? 'корінь' : packageRoot
  /** @type {string[]} */
  const vueFiles = []
  await walkDir(
    absRoot,
    absPath => {
      if (!absPath.endsWith('.vue')) return
      if (otherRootsAbs.some(other => absPath.startsWith(`${other}/`))) return
      vueFiles.push(absPath)
    },
    ignorePaths
  )
  if (vueFiles.length === 0) return

  let violations = 0
  for (const absPath of vueFiles) {
    const rel = relative(process.cwd(), absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    for (const match of content.matchAll(VUE_RASTER_IMPORT_RE)) {
      violations++
      const importPath = match[1]
      fail(
        `[${label}] ${rel}: import з '${importPath}' має посилатись на AVIF-двійник '${importPath}.avif' ` +
          `(lint-image --avif створює його поряд). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
      )
    }
    for (const match of content.matchAll(VUE_RASTER_STATIC_SRC_RE)) {
      violations++
      const srcPath = match[1]
      fail(
        `[${label}] ${rel}: пряме \`src="${srcPath}"\` у шаблоні має використовувати AVIF-двійник \`src="${srcPath}.avif"\` ` +
          `(або винеси у import + \`:src="..."\`). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
      )
    }
  }
  if (violations === 0) {
    pass(`[${label}] усі raster-посилання у .vue вже на .avif (або відсутні)`)
  }
}

/**
 * Сканує всі workspace-пакети: для кожного перевіряє opt-out і за потреби викликає
 * перевірку Vue-imports. Перевірка пропускається, якщо в репозиторії немає workspaces
 * або немає `.vue`-файлів — тоді `image` правило не для цього проєкту.
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>} резолвиться по завершенню перевірки всіх workspace-пакетів
 */
async function checkVueAvifImports(ignorePaths, pass, fail) {
  const roots = await getMonorepoPackageRootDirs()
  const absRootsByRel = new Map(roots.map(r => [r, join(process.cwd(), r)]))
  for (const root of roots) {
    const pkgPath = join(root, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    if (packageHasAvifDisabled(pkg)) {
      pass(
        `[${root === '.' ? 'корінь' : root}] avif-import enforcement вимкнено через "@nitra/minify-image.disable-avif"`
      )
      continue
    }
    const otherRootsAbs = roots.filter(r => r !== root && r !== '.').map(r => absRootsByRel.get(r) ?? '')
    await checkVueAvifImportsInPackage(root, otherRootsAbs, ignorePaths, pass, fail)
  }
}

/**
 * Перевіряє кореневий `package.json`: скрипти, заборонені залежності, агрегований `lint`.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<boolean>} `true`, якщо `package.json` знайдено й оброблено; `false` — нема
 */
async function checkPackageJsonImage(pass, fail) {
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (image.mdc)')
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
 * Перевіряє відповідність проєкту правилам `image.mdc` (split-cache 3.2.0):
 * `lint-image` через `npx @nitra/minify-image --src=. --write --avif`, агрегований `lint`,
 * `.n-minify-image.tsv` НЕ в `.gitignore` (committed source of truth), застарілий
 * `.minify-image-cache.tsv` видалений, AVIF-імпорти у `.vue` файлах. CI-workflow
 * для image не вимагається — лінт зображень виконується лише локально.
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
  const ignorePaths = await loadCursorIgnorePaths(process.cwd())
  await checkVueAvifImports(ignorePaths, pass, fail)

  return reporter.getExitCode()
}
