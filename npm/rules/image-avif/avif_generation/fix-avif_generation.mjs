/**
 * T0-autofix для `image-avif/avif_generation` — AVIF-етап: генерація `.avif`-двійників
 * (`npx \@nitra/minify-image --avif`), переписування raster-посилань у `.vue`/`.html` на
 * `<path>.avif` і прибирання `.avif`-сиріт.
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Дії резолвимо повторним скануванням (`scanAvif`) ПІСЛЯ генерації — згенеровані
 * `.avif` стають видимими, missing → rewrite. Idempotent: clean-стан → 0 змін.
 * У тестах генерацію можна вимкнути через `NITRA_CURSOR_NO_AVIF_RUN=1`.
 *
 * # Self-containment (PURE-фінал фази 5)
 *
 * Детектор (read-only violation-звітування) видалений разом із `main.mjs` —
 * тепер живе лише в `crates/rules-core/src/concerns/image_avif_generation.rs`.
 * T0-fix лишається JS (мутації файлової системи — поза мандатом native
 * detector-ів), тож `scanAvif` та всі допоміжні функції/regex-и/константи
 * (раніше спільні з `main.mjs`) продубльовані тут — той самий скан, що й у
 * Rust-порту (доккомент модуля `image_avif_generation.rs`, секція
 * «Self-containment T0-fix»), бо T0 потребує фактичний новий вміст
 * rewrite-ів і повний список orphan-шляхів, яких немає у `Violation`-DTO.
 */
import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { env } from 'node:process'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Стабільні reasons — той самий контракт, що й Rust-порт (`image_avif_generation.rs`). */
export const AVIF_NEEDS_REWRITE = 'avif-needs-rewrite'
/** Стабільний reason: для растрового зображення відсутній згенерований AVIF-двійник. */
export const AVIF_MISSING = 'avif-missing'
/** Стабільний reason: AVIF-файл лишився без растрового джерела — кандидат на cleanup. */
export const AVIF_ORPHAN = 'avif-orphan'

/** Імʼя CLI-пакета, який генерує AVIF. */
export const MINIFY_PACKAGE_NAME = '@nitra/minify-image'

/** Поле в `package.json` для конфігу `\@nitra/minify-image` (наприклад, `disable-avif`). */
const PKG_CONFIG_FIELD = '@nitra/minify-image'

/**
 * Імена каталогів, які cleanup НЕ зачіпає, бо це артефакти збірки/нативні
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
        `(\`npx @7n/rules fix image-avif\` створює його поряд, якщо оригінал є на диску). Вимкнути локально: "@nitra/minify-image": { "disable-avif": true } у package.json пакета`
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
 * перевірку Vue-imports. Повертає список абсолютних коренів пакетів, у яких ввімкнено
 * opt-out (`disable-avif: true`).
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
 * переписати на AVIF-двійник.
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<boolean>} `true`, якщо знайдено принаймні одне raster-посилання
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
 * Чистий read-only скан усього AVIF-етапу (без npx, без запису, без unlink). Той самий
 * скан, що й у native detector-і (`crates/rules-core/src/concerns/image_avif_generation.rs`,
 * доккомент модуля щодо self-containment) — тут потрібен для отримання фактичного нового
 * вмісту rewrite-ів і повного списку orphan-шляхів перед записом/unlink.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<AvifScan>} результат скану AVIF-етапу.
 */
async function scanAvif(cwd) {
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

const TRIGGER_REASONS = new Set([AVIF_NEEDS_REWRITE, AVIF_MISSING, AVIF_ORPHAN])

/**
 * Запускає `npx \@nitra/minify-image --src=. --write --avif` для генерації AVIF-двійників.
 * Best-effort: відсутній npx / помилка / ненульовий код — лог-варн без падіння (rewrite/
 * missing з наступного скану покажуть, де `.avif` все ще бракує). `NITRA_CURSOR_NO_AVIF_RUN=1`
 * — no-op (тести й ізольовані середовища).
 * @param {string} cwd корінь репозиторію
 * @returns {void}
 */
function runAvifGeneration(cwd) {
  if (env.NITRA_CURSOR_NO_AVIF_RUN === '1') return
  const npxPath = resolveCmd('npx')
  if (!npxPath) {
    console.log(`  ⚠️  'npx' не знайдено в PATH — пропускаємо генерацію AVIF`)
    return
  }
  const result = spawnSync(npxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--write', '--avif'], {
    cwd,
    env
  })
  if (result.error) {
    console.log(`  ⚠️  не вдалося запустити \`npx ${MINIFY_PACKAGE_NAME} --avif\`: ${result.error.message}`)
    return
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.log(`  ⚠️  \`npx ${MINIFY_PACKAGE_NAME} --avif\` завершився з кодом ${result.status}`)
  }
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'image-avif-generation',
    test: violations => violations.some(v => TRIGGER_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const cwd = ctx.cwd
      // Генерація може створити `.avif`, яких бракувало → rescan бачить їх як rewrite.
      runAvifGeneration(cwd)
      const scan = await scanAvif(cwd)
      if (scan.skipped) return { touchedFiles: [] }

      const touchedFiles = []
      for (const r of scan.rewrites) {
        ctx.recordWrite?.(r.file)
        await writeFile(r.file, r.content, 'utf8')
        touchedFiles.push(r.file)
      }
      for (const orphan of scan.orphans) {
        ctx.recordWrite?.(orphan)
        await unlink(orphan)
        touchedFiles.push(orphan)
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return {
        touchedFiles,
        message: `AVIF: rewrote ${scan.rewrites.length} file(s), deleted ${scan.orphans.length} orphan(s)`
      }
    }
  }
]
