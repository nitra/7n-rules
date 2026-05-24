/**
 * Перевіряє відповідність репозиторію правилу `image-avif.mdc`: AVIF-генерацію та
 * ув'язування `.avif`-двійників з посиланнями у `.vue`/`.html`.
 *
 * Дії під час `check image-avif`:
 * 1. **Pre-scan**: знайти в `.vue`/`.html` хоча б одне raster-посилання, яке потенційно
 *    можна переписати на AVIF-двійник (через `import x from '...png'` або
 *    `<img src="...png" />`). Пакети з opt-out `disable-avif: true` пропускаються.
 *    Якщо жодного raster-посилання не знайдено → exit 0 одразу (`npx --avif` не запускаємо,
 *    rewrite/cleanup-пасс теж пропускаємо — нічого не змінилось би).
 * 2. `npx \@nitra/minify-image --src=. --write --avif` — генерує AVIF-двійники.
 * 3. У кожному workspace-пакеті переписує raster-посилання у `.vue`/`.html` на `.avif`
 *    (де AVIF-двійник реально існує на диску). Pakety з `"\@nitra/minify-image": {
 *    "disable-avif": true }` у `package.json` пропускаються.
 * 4. Прибирає AVIF-сироти — `<name>.<ext>.avif`, на які не лишилось жодного посилання
 *    у `.vue`/`.html` репозиторію, видаляються (умова правила: «AVIF лишається лише
 *    там, де заміна вдалася»).
 *
 * Якщо raster-посилання у `.vue`/`.html` не вдалось переписати (наприклад, оригіналу
 * нема на диску → `.avif` теж не згенерувався) — фейл на конкретний файл.
 *
 * Правило самостійне від `image-compress`: AVIF можна вмикати лише в адмінках (де AVIF
 * підтримується сучасними браузерами) і не вмикати в публічних сайтах. Перевірка скрипта
 * `lint-image` (заборона `--avif` у ньому) залишається у `image-compress` — тут вона не
 * дублюється.
 */
import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Імʼя CLI-пакета, який генерує AVIF. */
const MINIFY_PACKAGE_NAME = '@nitra/minify-image'

/** Поле в `package.json` для конфігу `\@nitra/minify-image` (наприклад, `disable-avif`). */
const PKG_CONFIG_FIELD = '@nitra/minify-image'

/**
 * Імена каталогів, які `cleanupOrphanAvifs` не зачіпає, бо це артефакти збірки/нативні
 * платформи — `.avif` всередині — це продукт попереднього `bun run build`/Capacitor sync,
 * а не кандидати на видалення. `walkDir` уже скіпає `node_modules`, `.git`, `dist`,
 * `coverage`, `.turbo`, `.next` — додатково для cleanup ігноруємо ще ці.
 */
const CLEANUP_EXTRA_IGNORE_DIR_NAMES = new Set(['build', 'android', 'ios', '.output', '.nuxt', '.cache'])

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
 * Будує впорядкований список кандидатів-абсолютних шляхів, по яких треба перевіряти
 * наявність зображення для даного посилання у `.vue`/`.html`. Caller перевіряє кожен
 * кандидат на існування `<candidate>.avif` (для rewrite) або `<candidate>` (для збору
 * вже-вживаного `.avif`) і обирає перший, що існує.
 *
 * Підтримувані форми:
 * - `./x.png`, `../x.png` — відносно файла-джерела (ES-import / asset-relative).
 * - `/x.png` — у Vite/Quasar-конвенції це `<packageRoot>/public/x.png`. Спочатку пробуємо
 *   `public/`, потім сам корінь пакета (на випадок mono-репо без `public/`), нарешті
 *   `<cwd>/x.png` як legacy fallback (щоб не зламати проєкти з кореневими ассетами).
 * - голий шлях з принаймні одним `/` (`assets/img.png`, `start-page-ua/logo.png`) — у
 *   HTML/Vue браузер резолвить його відносно документа, тому повертаємо relative-to-source
 *   та `<packageRoot>/public/<path>` як другий кандидат (Quasar-проєкти кладуть public-assets
 *   саме туди).
 * - bare без `/` (`foo`) — ймовірно alias resolver (Vite/Webpack), резолвити не вміємо,
 *   повертаємо порожній список → caller просто пропускає посилання, не звітує fail.
 * @param {string} importPath шлях з `import x from '...'` або `src="..."`
 * @param {string} sourceAbsPath абсолютний шлях файла-джерела
 * @param {string|null} packageRootAbs абсолютний корінь workspace-пакета, у якому лежить
 * `sourceAbsPath` (для резолвера `/path` як `<root>/public<path>`); `null`, якщо невідомо
 * @returns {string[]} впорядкований список абсолютних шляхів-кандидатів
 */
function resolveImageCandidates(importPath, sourceAbsPath, packageRootAbs) {
  if (importPath.startsWith('.')) {
    return [join(sourceAbsPath, '..', importPath)]
  }
  if (importPath.startsWith('/')) {
    /** @type {string[]} */
    const candidates = []
    if (packageRootAbs) {
      candidates.push(join(packageRootAbs, 'public', importPath), join(packageRootAbs, importPath))
    }
    candidates.push(join(process.cwd(), importPath))
    return candidates
  }
  if (importPath.includes('/')) {
    /** @type {string[]} */
    const candidates = [join(sourceAbsPath, '..', importPath)]
    if (packageRootAbs) {
      candidates.push(join(packageRootAbs, 'public', importPath))
    }
    return candidates
  }
  return []
}

/**
 * Аґреговані лічильники по проходу `check image-avif`:
 *   - `rewrittenRefs` — скільки конкретних посилань (по одному на match) переписано на `.avif`;
 *   - `rewrittenFiles` — у скількох `.vue`/`.html` файлах хоч одне посилання змінилося;
 *   - `failedRefs` — скільки конкретних посилань не вдалося переписати (`.avif` не існував).
 * @typedef {object} RewriteStats
 * @property {number} rewrittenRefs скільки конкретних посилань переписано на `.avif`
 * @property {number} rewrittenFiles у скількох `.vue`/`.html` файлах хоч одне посилання змінилося
 * @property {number} failedRefs скільки конкретних посилань не вдалося переписати (`.avif` не існував)
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
        const candidates = resolveImageCandidates(importPath, absPath, absRoot)
        if (candidates.length === 0) {
          // Bare alias (наприклад, '@/assets/x.png' без `/` — впізнаваний alias у Vite/WP);
          // резолвера тут нема, тому посилання не чіпаємо і не звітуємо як fail.
          return full
        }
        const newImportPath = `${importPath}.avif`
        const replaced = full.replace(importPath, newImportPath)
        const found = candidates.find(c => existsSync(`${c}.avif`))
        if (found) {
          stats.rewrittenRefs++
          usedAvifAbs.add(`${found}.avif`)
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
        `(\`npx @nitra/cursor fix image-avif\` створює його поряд, якщо оригінал є на диску). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
    )
    processMatches(
      VUE_RASTER_STATIC_SRC_RE,
      srcPath =>
        `[${label}] ${rel}: пряме \`src="${srcPath}"\` у шаблоні має використовувати AVIF-двійник \`src="${srcPath}.avif"\` ` +
        `(або винеси у import + \`:src="..."\`). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
    )

    for (const match of updated.matchAll(VUE_AVIF_REF_RE)) {
      const avifPath = match[1]
      const candidates = resolveImageCandidates(avifPath, absPath, absRoot)
      for (const cand of candidates) {
        if (existsSync(cand)) usedAvifAbs.add(cand)
      }
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
 * або немає `.vue`-файлів — тоді `image-avif` правило не для цього проєкту.
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
 * Pre-scan: чи є в `.vue`/`.html` хоча б одне raster-посилання, яке потенційно треба
 * переписати на AVIF-двійник (через `import x from '...png'` або `<img src="...png" />`).
 *
 * Якщо false — весь подальший етап `image-avif` пропускаємо: ні `npx --avif`, ні rewrite,
 * ні cleanup-сиріт не дали б ніяких змін. Сенс — не запускати дорогий `npx \@nitra/minify-image`
 * у проєктах, де AVIF не вживається (а опційно і не плануються).
 *
 * Скан робиться тими самими regexp-ами, що й основний rewrite-пасс (`VUE_RASTER_IMPORT_RE`
 * + `VUE_RASTER_STATIC_SRC_RE`), і ходить лише по `.vue`/`.html` у workspace-пакетах, що НЕ
 * мають opt-out `"@nitra/minify-image": { "disable-avif": true }` (інакше їхні шаблони ми
 * все одно не сканували б, тож вони не мають провокувати запуск AVIF-етапу).
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<boolean>} `true`, якщо знайдено принаймні одне raster-посилання
 */
async function hasAnyVueRasterReference(ignorePaths) {
  const roots = await getMonorepoPackageRootDirs()
  const absRootsByRel = new Map(roots.map(r => [r, join(process.cwd(), r)]))
  for (const root of roots) {
    const pkgPath = join(root, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      if (packageHasAvifDisabled(pkg)) continue
    }
    const absRoot = absRootsByRel.get(root) ?? join(process.cwd(), root)
    const otherRootsAbs = roots.filter(r => r !== root && r !== '.').map(r => absRootsByRel.get(r) ?? '')
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
    for (const absPath of targetFiles) {
      const content = await readFile(absPath, 'utf8')
      VUE_RASTER_IMPORT_RE.lastIndex = 0
      if (VUE_RASTER_IMPORT_RE.test(content)) return true
      VUE_RASTER_STATIC_SRC_RE.lastIndex = 0
      if (VUE_RASTER_STATIC_SRC_RE.test(content)) return true
    }
  }
  return false
}

/**
 * Запускає `npx \@nitra/minify-image --src=. --write --avif` для генерації AVIF-двійників.
 *
 * Виклик best-effort: якщо мережа/кеш недоступні чи бінарника нема — лог-варн без падіння
 * перевірки (валідації package.json і vue-refs все одно прогоняться, vue-refs на
 * відсутні `.avif` фейлять окремо). У тестах та інших ізольованих середовищах npx
 * можна вимкнути через `NITRA_CURSOR_NO_AVIF_RUN=1` — тоді ця функція no-op.
 * @returns {void}
 */
function runAvifGeneration() {
  if (env.NITRA_CURSOR_NO_AVIF_RUN === '1') return
  const npxPath = resolveCmd('npx')
  if (!npxPath) {
    console.log(
      `  ⚠️  'npx' не знайдено в PATH — пропускаємо генерацію AVIF; vue/html-перевірка покаже файли, для яких не вистачає .avif`
    )
    return
  }
  const result = spawnSync(npxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--write', '--avif'], {
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
 * ідемпотентність повторного `check image-avif` для пакетів, що навмисно вимкнули правило
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
      const segments = absPath.split('/')
      if (segments.some(seg => CLEANUP_EXTRA_IGNORE_DIR_NAMES.has(seg))) return
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
 * Виконує AVIF-етап: запуск AVIF-генерації, авто-заміна raster-посилань у `.vue`/`.html`,
 * видалення AVIF-сиріт. Не валідує `package.json`/`lint-image` — це вже у `image-compress`.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const ignorePaths = await loadCursorIgnorePaths(process.cwd())

  if (!(await hasAnyVueRasterReference(ignorePaths))) {
    pass('image-avif: у .vue/.html немає raster-посилань для переписування — AVIF-генерація і cleanup пропущені')
    return reporter.getExitCode()
  }

  runAvifGeneration()

  /** @type {Set<string>} */
  const usedAvifAbs = new Set()
  /** @type {RewriteStats} */
  const stats = { rewrittenRefs: 0, rewrittenFiles: 0, failedRefs: 0 }
  const optedOutAbs = await checkVueAvifImports(ignorePaths, usedAvifAbs, stats, pass, fail)
  const orphansDeleted = await cleanupOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths)

  pass(
    `image-avif: rewrote ${stats.rewrittenRefs} reference${stats.rewrittenRefs === 1 ? '' : 's'} in ${stats.rewrittenFiles} file${stats.rewrittenFiles === 1 ? '' : 's'}; ` +
      `deleted ${orphansDeleted} orphan AVIF${orphansDeleted === 1 ? '' : 's'}; ` +
      `failed to rewrite ${stats.failedRefs} reference${stats.failedRefs === 1 ? '' : 's'}`
  )

  return reporter.getExitCode()
}
