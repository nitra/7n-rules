/**
 * @see ./docs/avif_generation.md
 *
 * Read-only detector: лише СКАНУЄ `.vue`/`.html` і ЗВІТУЄ raster-посилання, яким
 * бракує `.avif`-двійника (`avif-needs-rewrite` — двійник є, треба переписати ref;
 * `avif-missing` — двійника немає; `avif-orphan` — `.avif` без живих посилань).
 * AVIF-генерацію (npx), переписування посилань і прибирання сиріт виконує окремий
 * T0-fix (`fix-avif_generation.mjs`) — `lint --no-fix` не мутує дерево.
 * Сканер (`scanAvif`) і helper-и спільні для detector/T0.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Стабільні reasons. */
export const AVIF_NEEDS_REWRITE = 'avif-needs-rewrite'
export const AVIF_MISSING = 'avif-missing'
export const AVIF_ORPHAN = 'avif-orphan'

/** Імʼя CLI-пакета, який генерує AVIF (використовує T0-fix). */
export const MINIFY_PACKAGE_NAME = '@nitra/minify-image'

/** Поле в `package.json` для конфігу `\@nitra/minify-image` (наприклад, `disable-avif`). */
const PKG_CONFIG_FIELD = '@nitra/minify-image'

/**
 * Імена каталогів, які cleanup НЕ зачіпає, бо це артефакти збірки/нативні
 * платформи — `.avif` всередині — це продукт попереднього `bun run build`/Capacitor sync,
 * а не кандидати на видалення. `walkDir` уже скіпає `node_modules`, `.git`, `dist`,
 * `coverage`, `.turbo`, `.next` — додатково для cleanup ігноруємо ще ці.
 * @param {string} cwd корінь репозиторію
 */
export const CLEANUP_EXTRA_IGNORE_DIR_NAMES = new Set(['build', 'android', 'ios', '.output', '.nuxt', '.cache'])

/**
 * Регексп для імпортів raster-зображень у `.vue` файлах.
 * Захоплює `import name from '...ext'` (як default, так і type-only форми не потрібні —
 * type-imports asset-ів не існує). Захоплюється повний шлях у групі 1.
 * @param {string} cwd корінь репозиторію
 */
const VUE_RASTER_IMPORT_RE = /import\s+\w[\w$]*\s+from\s+['"]([^'"\n]+\.(?:png|jpe?g|gif))['"]/giu

/**
 * Регексп для прямих посилань на raster-зображення у HTML-атрибуті `src="..."` шаблона `.vue`
 * (наприклад `<img src="./hero.png" />`). Vite перетворює такі шляхи на asset-імпорти на етапі
 * збірки, тож для них теж діє вимога вживати AVIF-двійник.
 *
 * Лукбехайнд `(?<![:\-_.])` виключає реактивне `:src="..."` (там JS-вираз — змінна або виклик,
 * перевіряється через імпорт), `data-src="..."` і `obj.src=...` у `<script>`.
 * @param {string} cwd корінь репозиторію
 */
const VUE_RASTER_STATIC_SRC_RE = /(?<![:\-_.])\bsrc\s*=\s*['"]([^'"\s]+\.(?:png|jpe?g|gif))['"]/giu

/**
 * Регексп для готових AVIF-посилань у `.vue`/`.html` (як `import x from '...png.avif'`,
 * так і `<img src="....png.avif" />`). Потрібен лише для збору множини «живих» AVIF —
 * щоб після авто-заміни знати, які `<...>.avif` файли ще на щось посилаються, а які
 * є сиротами і підлягають видаленню.
 * @param {string} cwd корінь репозиторію
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
 *   HTML/Vue браузер визначає його відносно документа, тому повертаємо relative-to-source
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
 * Запланована заміна вмісту одного `.vue`/`.html` файла (raster-посилання → `.avif`).
 * @typedef {object} AvifRewrite
 * @property {string} file абсолютний шлях файла
 * @property {string} content новий вміст (із переписаними посиланнями)
 */

/**
 * Зафіксований провал: raster-посилання, для якого `.avif`-двійника немає на диску.
 * @typedef {object} AvifMissing
 * @property {string} file абсолютний шлях файла-джерела
 * @property {string} message людиночитне повідомлення (вже з міткою/relative-шляхом)
 */

/**
 * Read-only скан `.vue`/`.html` одного workspace-пакета: ОБЧИСЛЮЄ потрібні
 * rewrite-и raster-посилань на `.avif`-двійник (без запису) і фіксує посилання, для
 * яких двійника немає (`missing`). Доповнює `usedAvifAbs` шляхами AVIF-двійників, на
 * які лишилось живе посилання.
 *
 * Файли, що належать іншим workspace-пакетам, ігноруються — кожен пакет сканується рівно
 * один раз (інакше при обході кореня `.` ми б повторно зайшли в `demo/` і подвоїли звіти).
 * @param {string} packageRoot відносний шлях до кореня пакета (наприклад `'.'` або `'demo'`)
 * @param {string[]} otherRootsAbs абсолютні шляхи інших workspace-коренів — їх піддерева пропускаємо
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {Set<string>} usedAvifAbs мутабельна множина абсолютних шляхів `.avif`, що мають
 * хоч одне посилання у `.vue`/`.html` (доповнюється у цій функції)
 * @param {AvifRewrite[]} rewrites мутабельний акумулятор запланованих rewrite-ів
 * @param {AvifMissing[]} missing мутабельний акумулятор провалів (немає `.avif`)
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<void>}
 */
async function scanVueAvifInPackage(packageRoot, otherRootsAbs, ignorePaths, usedAvifAbs, rewrites, missing, cwd) {
  const absRoot = join(cwd, packageRoot)
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
    const rel = relative(cwd, absPath).split('\\').join('/')
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
        const replaced = full.replace(importPath, () => newImportPath)
        const found = candidates.find(c => existsSync(`${c}.avif`))
        if (found) {
          usedAvifAbs.add(`${found}.avif`)
          return replaced
        }
        missing.push({ file: absPath, message: renderFailure(importPath) })
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
      rewrites.push({ file: absPath, content: updated })
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
 * @param {AvifRewrite[]} rewrites акумулятор запланованих rewrite-ів (мутується)
 * @param {AvifMissing[]} missing акумулятор провалів — немає `.avif` (мутується)
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи коренів пакетів з активним opt-out
 */
async function scanVueAvifImports(ignorePaths, usedAvifAbs, rewrites, missing, cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const absRootsByRel = new Map(roots.map(r => [r, join(cwd, r)]))
  /** @type {string[]} */
  const optedOutAbs = []
  for (const root of roots) {
    const pkgPath = join(cwd, root, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    if (packageHasAvifDisabled(pkg)) {
      optedOutAbs.push(absRootsByRel.get(root) ?? join(cwd, root))
      continue
    }
    const otherRootsAbs = roots.filter(r => r !== root && r !== '.').map(r => absRootsByRel.get(r) ?? '')
    await scanVueAvifInPackage(root, otherRootsAbs, ignorePaths, usedAvifAbs, rewrites, missing, cwd)
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
 * @param {string} cwd корінь репозиторію
 */
async function hasAnyVueRasterReference(ignorePaths, cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const absRootsByRel = new Map(roots.map(r => [r, join(cwd, r)]))
  for (const root of roots) {
    const pkgPath = join(cwd, root, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      if (packageHasAvifDisabled(pkg)) continue
    }
    const absRoot = absRootsByRel.get(root) ?? join(cwd, root)
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
 * Read-only: збирає AVIF-сироти — `<...>.avif`, на які не лишилось жодного живого
 * посилання у `.vue`/`.html`. НЕ видаляє (T0 робить unlink). AVIF у opt-out пакетах
 * пропускаються (ми не сканували їх шаблони → не маємо права вважати сиротами).
 * @param {Set<string>} usedAvifAbs абсолютні шляхи `.avif`, що мають живі посилання
 * @param {string[]} optedOutAbs абсолютні шляхи коренів opt-out пакетів — їх `.avif` не чіпаємо
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи сиріт-кандидатів на видалення
 */
async function collectOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths, cwd) {
  /** @type {string[]} */
  const orphans = []
  await walkDir(
    cwd,
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
  return orphans
}

/**
 * Результат read-only скану AVIF-етапу.
 * @typedef {object} AvifScan
 * @property {boolean} skipped true — у `.vue`/`.html` немає raster-посилань (нічого робити)
 * @property {AvifRewrite[]} rewrites заплановані rewrite-и raster-посилань на `.avif`
 * @property {AvifMissing[]} missing raster-посилання без `.avif`-двійника на диску
 * @property {string[]} orphans `.avif`-сироти на видалення
 */

/**
 * Чистий read-only скан усього AVIF-етапу (без npx, без запису, без unlink). Спільний
 * для detector-а (→ violations) і T0-fix (виконує генерацію, потім rescan + write/unlink).
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<AvifScan>} результат скану AVIF-етапу.
 */
export async function scanAvif(cwd) {
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  if (!(await hasAnyVueRasterReference(ignorePaths, cwd))) {
    return { skipped: true, rewrites: [], missing: [], orphans: [] }
  }
  /** @type {Set<string>} */
  const usedAvifAbs = new Set()
  /** @type {AvifRewrite[]} */
  const rewrites = []
  /** @type {AvifMissing[]} */
  const missing = []
  const optedOutAbs = await scanVueAvifImports(ignorePaths, usedAvifAbs, rewrites, missing, cwd)
  const orphans = await collectOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths, cwd)
  return { skipped: false, rewrites, missing, orphans }
}

/**
 * Read-only detector AVIF-етапу: ЗВІТУЄ потрібні rewrite-и (`avif-needs-rewrite`),
 * відсутні `.avif`-двійники (`avif-missing`) і `.avif`-сироти (`avif-orphan`).
 * Не валідує image-compress cache/dependency policy — це окреме правило.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями.
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  const scan = await scanAvif(cwd)
  if (scan.skipped) return reporter.result()

  for (const r of scan.rewrites) {
    reporter.fail(
      `${relative(cwd, r.file).split('\\').join('/')}: raster-посилання має вживати AVIF-двійник — запусти \`npx @nitra/cursor fix image-avif\` (image-avif.mdc)`,
      { reason: AVIF_NEEDS_REWRITE, file: relative(cwd, r.file).split('\\').join('/') }
    )
  }
  for (const m of scan.missing) {
    reporter.fail(m.message, {
      reason: AVIF_MISSING,
      file: relative(cwd, m.file).split('\\').join('/')
    })
  }
  for (const orphan of scan.orphans) {
    reporter.fail(
      `${relative(cwd, orphan).split('\\').join('/')}: AVIF-сирота без живих посилань — запусти \`npx @nitra/cursor fix image-avif\` (image-avif.mdc)`,
      { reason: AVIF_ORPHAN, file: relative(cwd, orphan).split('\\').join('/') }
    )
  }

  return reporter.result()
}
