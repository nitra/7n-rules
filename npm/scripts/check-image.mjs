/**
 * Перевіряє відповідність репозиторію правилу image.mdc для оптимізації зображень
 * через `@nitra/minify-image` ≥ 3.2.0 (локально — у CI лінт зображень не запускається).
 *
 * Очікування:
 * - у кореневому `package.json` є скрипт `lint-image`, який викликає `npx @nitra/minify-image`
 *   з обовʼязковими `--src=.` і `--write`. Прапорець `--avif` у `lint-image` заборонений —
 *   AVIF-генерацію виконує `check image` (інакше `bun run lint` плодив би `.avif` для
 *   зображень, що ніде не вживаються);
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
 *
 * Дії під час `check image` (на додачу до валідацій):
 * 1. `npx @nitra/minify-image --src=. --write --avif` — генерує AVIF-двійники.
 * 2. У кожному workspace-пакеті переписує raster-посилання у `.vue`/`.html` на `.avif`
 *    (де AVIF-двійник реально існує на диску). Pakety з `"@nitra/minify-image": {
 *    "disable-avif": true }` у `package.json` пропускаються.
 * 3. Прибирає AVIF-сироти — `<name>.<ext>.avif`, на які не лишилось жодного посилання
 *    у `.vue`/`.html` репозиторію, видаляються (умова правила: «AVIF лишається лише
 *    там, де заміна вдалася»).
 *
 * Якщо raster-посилання у `.vue`/`.html` не вдалось переписати (наприклад, оригіналу
 * нема на диску → `.avif` теж не згенерувався) — фейл на конкретний файл, як раніше.
 */
import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

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
 * Регексп для готових AVIF-посилань у `.vue`/`.html` (як `import x from '...png.avif'`,
 * так і `<img src="....png.avif" />`). Потрібен лише для збору множини «живих» AVIF —
 * щоб після авто-заміни знати, які `<...>.avif` файли ще на щось посилаються, а які
 * є сиротами і підлягають видаленню.
 */
const VUE_AVIF_REF_RE = /['"]([^'"\s]+\.(?:png|jpe?g|gif)\.avif)['"]/giu

/**
 * Перевіряє скрипт `lint-image` у `package.json`.
 *
 * Має містити виклик `npx @nitra/minify-image` з обовʼязковими прапорцями `--src=.`
 * і `--write` (авто-оптимізація на місці). Прапорець `--avif` у `lint-image`
 * заборонений — AVIF-генерацію виконує `check image`, інакше `bun run lint` плодить
 * `.avif` для зображень, що ніде не вживаються.
 * @param {string|undefined} lintImage значення `scripts['lint-image']`
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {void}
 */
function checkLintImageScript(lintImage, pass, fail) {
  const canonical = `npx ${MINIFY_PACKAGE_NAME} --src=. --write`
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
    { flag: '--write', variants: ['--write'], hint: '`--write` (авто-оптимізація на місці)' }
  ]
  const missing = requiredFlags.filter(f => !f.variants.some(v => lintImage.includes(v)))
  if (missing.length > 0) {
    fail(
      `package.json: lint-image має містити ${missing.map(f => f.hint).join(', ')} — канонічний виклик: \`${canonical}\` (image.mdc)`
    )
    return
  }
  if (lintImage.includes('--avif')) {
    fail(
      `package.json: прибери \`--avif\` з lint-image — AVIF-генерацію виконує \`npx @nitra/cursor check image\` (image.mdc). Канонічний виклик: \`${canonical}\``
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
 * Резолвить шлях зображення з імпорта/атрибуту відносно файла, що його містить, до абсолютного
 * шляху файла на диску. Шляхи, що не починаються з `.` чи `/`, не резолвимо (alias-resolver
 * Vite/тощо невідомий тут — залишаємо такі посилання як є).
 * @param {string} importPath шлях у `import x from '...'` або `src="..."`
 * @param {string} sourceAbsPath абсолютний шлях файла з посиланням
 * @returns {string|null} абсолютний шлях зображення або `null`, якщо резолвити не можемо
 */
function resolveImagePath(importPath, sourceAbsPath) {
  if (importPath.startsWith('.')) {
    return join(sourceAbsPath, '..', importPath)
  }
  if (importPath.startsWith('/')) {
    return join(process.cwd(), importPath)
  }
  return null
}

/**
 * Аґреговані лічильники по проходу `check image`:
 *   - `rewrittenRefs` — скільки конкретних посилань (по одному на match) переписано на `.avif`;
 *   - `rewrittenFiles` — у скількох `.vue`/`.html` файлах хоч одне посилання змінилося;
 *   - `failedRefs` — скільки конкретних посилань не вдалося переписати (`.avif` не існував).
 * @typedef {object} RewriteStats
 * @property {number} rewrittenRefs
 * @property {number} rewrittenFiles
 * @property {number} failedRefs
 */

/**
 * Сканує `.vue` і `.html` файли одного workspace-пакета: де можемо, переписує raster-посилання
 * на `<path>.avif`, де не можемо — фейлимо. Доповнює `usedAvifAbs` шляхами AVIF-двійників, на
 * які лишилось живе посилання, і `stats` лічильниками rewrite/fail для глобального підсумку.
 *
 * Заміна виконується ТІЛЬКИ якщо AVIF-двійник реально існує на диску. Якщо AVIF немає
 * (наприклад, оригіналу теж немає, тож `--avif` його не згенерував) — фейл, як раніше.
 * Запис файла відбувається ОДРАЗУ після обробки одного файла (write-then-fail): провал на
 * наступному файлі НЕ відкочує вже записані зміни попередніх.
 *
 * Файли, що належать іншим workspace-пакетам, ігноруються — кожен пакет перевіряється рівно
 * один раз (інакше при обході кореня `.` ми б повторно зайшли в `demo/` і подвоїли звіти).
 * @param {string} packageRoot відносний шлях до кореня пакета (наприклад `'.'` або `'demo'`)
 * @param {string[]} otherRootsAbs абсолютні шляхи інших workspace-коренів — їх піддерева пропускаємо
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {Set<string>} usedAvifAbs мутабельна множина абсолютних шляхів `.avif`, що мають
 * хоч одне посилання у `.vue`/`.html` (доповнюється у цій функції)
 * @param {RewriteStats} stats глобальні лічильники, що мутуються тут
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>} резолвиться по завершенню перевірки одного пакета
 */
async function checkVueAvifImportsInPackage(packageRoot, otherRootsAbs, ignorePaths, usedAvifAbs, stats, fail) {
  const absRoot = join(process.cwd(), packageRoot)
  const label = packageRoot === '.' ? 'корінь' : packageRoot
  /** @type {string[]} */
  const targetFiles = []
  await walkDir(
    absRoot,
    absPath => {
      if (!absPath.endsWith('.vue') && !absPath.endsWith('.html')) return
      if (otherRootsAbs.some(other => absPath.startsWith(`${other}/`))) return
      targetFiles.push(absPath)
    },
    ignorePaths
  )
  if (targetFiles.length === 0) return

  for (const absPath of targetFiles) {
    const rel = relative(process.cwd(), absPath).split('\\').join('/')
    const original = await readFile(absPath, 'utf8')
    let updated = original

    /**
     * @param {RegExp} regex з групою 1 = шлях до зображення
     * @param {(srcPath: string) => string} renderFailure повідомлення помилки
     */
    const processMatches = (regex, renderFailure) => {
      updated = updated.replaceAll(regex, (full, importPath) => {
        const newImportPath = `${importPath}.avif`
        const replaced = full.replace(importPath, newImportPath)
        const imageAbs = resolveImagePath(importPath, absPath)
        if (imageAbs && existsSync(`${imageAbs}.avif`)) {
          stats.rewrittenRefs++
          usedAvifAbs.add(`${imageAbs}.avif`)
          return replaced
        }
        stats.failedRefs++
        fail(renderFailure(importPath))
        return full
      })
    }

    processMatches(
      VUE_RASTER_IMPORT_RE,
      importPath =>
        `[${label}] ${rel}: import з '${importPath}' має посилатись на AVIF-двійник '${importPath}.avif' ` +
        `(\`npx @nitra/cursor check image\` створює його поряд, якщо оригінал є на диску). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
    )
    processMatches(
      VUE_RASTER_STATIC_SRC_RE,
      srcPath =>
        `[${label}] ${rel}: пряме \`src="${srcPath}"\` у шаблоні має використовувати AVIF-двійник \`src="${srcPath}.avif"\` ` +
        `(або винеси у import + \`:src="..."\`). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
    )

    for (const match of updated.matchAll(VUE_AVIF_REF_RE)) {
      const avifPath = match[1]
      const avifAbs = resolveImagePath(avifPath, absPath)
      if (avifAbs) usedAvifAbs.add(avifAbs)
    }

    if (updated !== original) {
      await writeFile(absPath, updated, 'utf8')
      stats.rewrittenFiles++
    }
  }
}

/**
 * Сканує всі workspace-пакети: для кожного перевіряє opt-out і за потреби викликає
 * перевірку Vue-imports. Перевірка пропускається, якщо в репозиторії немає workspaces
 * або немає `.vue`-файлів — тоді `image` правило не для цього проєкту.
 *
 * Повертає список абсолютних коренів пакетів, у яких ввімкнено opt-out (`disable-avif: true`).
 * Це окремий результат, бо AVIF всередині такого пакета НЕ можна вважати «сиротою» лише
 * на підставі відсутності посилань у його `.vue`/`.html` (ми взагалі не сканували його
 * шаблони) — інакше cleanup помилково затирав би AVIF, що використовуються через alias /
 * runtime-обчислений шлях / зовнішні посилання, які тут не видно.
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {Set<string>} usedAvifAbs мутабельна множина абсолютних шляхів `.avif`-двійників,
 * на які лишилось хоча б одне посилання у `.vue`/`.html` (заповнюється у викликаних функціях)
 * @param {RewriteStats} stats глобальні лічильники rewrite/fail (мутуються нижче)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<string[]>} абсолютні шляхи коренів пакетів з активним opt-out
 */
async function checkVueAvifImports(ignorePaths, usedAvifAbs, stats, pass, fail) {
  const roots = await getMonorepoPackageRootDirs()
  const absRootsByRel = new Map(roots.map(r => [r, join(process.cwd(), r)]))
  /** @type {string[]} */
  const optedOutAbs = []
  for (const root of roots) {
    const pkgPath = join(root, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    if (packageHasAvifDisabled(pkg)) {
      pass(
        `[${root === '.' ? 'корінь' : root}] avif-import enforcement вимкнено через "@nitra/minify-image.disable-avif"`
      )
      optedOutAbs.push(absRootsByRel.get(root) ?? join(process.cwd(), root))
      continue
    }
    const otherRootsAbs = roots.filter(r => r !== root && r !== '.').map(r => absRootsByRel.get(r) ?? '')
    await checkVueAvifImportsInPackage(root, otherRootsAbs, ignorePaths, usedAvifAbs, stats, fail)
  }
  return optedOutAbs
}

/**
 * Чи є в репозиторії хоч один raster-файл, який мав би сенс конвертувати у AVIF.
 * Якщо немає — `npx @nitra/minify-image` нема що робити, тож зайвий запуск пропускаємо
 * (важливо у тестах: фікстурні `.png`-імпорти посилаються на неіснуючі файли, тож
 * minify-image все одно нічого не згенерує — а зайвий npx-спавн повільний і робить шум).
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<boolean>} `true`, якщо знайдено принаймні один `.png/.jpe?g/.gif`
 */
async function hasAnyRasterImage(ignorePaths) {
  let found = false
  await walkDir(
    process.cwd(),
    absPath => {
      if (found) return
      if (/\.(?:png|jpe?g|gif)$/iu.test(absPath)) found = true
    },
    ignorePaths
  )
  return found
}

/**
 * Запускає `npx @nitra/minify-image --src=. --write --avif` для генерації AVIF-двійників.
 *
 * Виклик best-effort: якщо мережа/кеш недоступні чи бінарника нема — лог-варн без падіння
 * перевірки (валідації package.json і vue-refs все одно прогоняться, vue-refs на
 * відсутні `.avif` фейлять окремо). У тестах та інших ізольованих середовищах npx
 * можна вимкнути через `NITRA_CURSOR_NO_AVIF_RUN=1` — тоді ця функція no-op.
 * @returns {void}
 */
function runAvifGeneration() {
  if (env.NITRA_CURSOR_NO_AVIF_RUN === '1') return
  const result = spawnSync('npx', [MINIFY_PACKAGE_NAME, '--src=.', '--write', '--avif'], {
    stdio: 'inherit',
    env
  })
  if (result.error) {
    console.log(
      `  ⚠️  не вдалося запустити \`npx ${MINIFY_PACKAGE_NAME} --avif\`: ${result.error.message} — vue/html-перевірка покаже файли, для яких не вистачає .avif`
    )
    return
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.log(
      `  ⚠️  \`npx ${MINIFY_PACKAGE_NAME} --avif\` завершився з кодом ${result.status} — vue/html-перевірка покаже файли, для яких не вистачає .avif`
    )
  }
}

/**
 * Видаляє AVIF-сироти — `<...>.avif` файли, на які не лишилось жодного посилання
 * у `.vue`/`.html` репозиторію. Реалізує умову правила: «AVIF лишається лише там,
 * де заміна реально вдалася».
 *
 * AVIF файли всередині opt-out пакетів (`disable-avif: true`) пропускаються — ми не
 * сканували їх шаблони, тож не маємо права вважати їх AVIF сиротами. Це гарантує
 * ідемпотентність повторного `check image` для пакетів, що навмисно вимкнули правило
 * (наприклад, мобільний бандл, де AVIF підтримка не гарантована).
 * @param {Set<string>} usedAvifAbs абсолютні шляхи `.avif`, що мають живі посилання
 * @param {string[]} optedOutAbs абсолютні шляхи коренів пакетів з опт-аутом —
 * `.avif` під ними не вважаємо сиротами і не видаляємо
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<number>} кількість видалених сиріт
 */
async function cleanupOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths) {
  /** @type {string[]} */
  const orphans = []
  await walkDir(
    process.cwd(),
    absPath => {
      if (!absPath.endsWith('.avif')) return
      if (usedAvifAbs.has(absPath)) return
      if (optedOutAbs.some(root => absPath === root || absPath.startsWith(`${root}/`))) return
      orphans.push(absPath)
    },
    ignorePaths
  )
  for (const absPath of orphans) {
    await unlink(absPath)
  }
  return orphans.length
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
 * `lint-image` через `npx @nitra/minify-image --src=. --write` (без `--avif`!), агрегований `lint`,
 * `.n-minify-image.tsv` НЕ в `.gitignore` (committed source of truth), застарілий
 * `.minify-image-cache.tsv` видалений. Окремо виконуються дії: запуск AVIF-генерації,
 * авто-заміна raster-посилань у `.vue`/`.html`, видалення AVIF-сиріт. CI-workflow
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

  if (await hasAnyRasterImage(ignorePaths)) {
    runAvifGeneration()
  }

  /** @type {Set<string>} */
  const usedAvifAbs = new Set()
  /** @type {RewriteStats} */
  const stats = { rewrittenRefs: 0, rewrittenFiles: 0, failedRefs: 0 }
  const optedOutAbs = await checkVueAvifImports(ignorePaths, usedAvifAbs, stats, pass, fail)
  const orphansDeleted = await cleanupOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths)

  pass(
    `image: rewrote ${stats.rewrittenRefs} reference${stats.rewrittenRefs === 1 ? '' : 's'} in ${stats.rewrittenFiles} file${stats.rewrittenFiles === 1 ? '' : 's'}; ` +
      `deleted ${orphansDeleted} orphan AVIF${orphansDeleted === 1 ? '' : 's'}; ` +
      `failed to rewrite ${stats.failedRefs} reference${stats.failedRefs === 1 ? '' : 's'}`
  )

  return reporter.getExitCode()
}
