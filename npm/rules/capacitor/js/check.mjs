/**
 * Перевіряє відповідність проєкту правилам capacitor.mdc для застосунків **Capacitor**.
 *
 * Якщо у репозиторії **немає** ознак Capacitor (див. наведене) — вихід **0**, перевірка не застосовується.
 *
 * **Ознака Capacitor:** наявні **`capacitor.config.json`**, **`capacitor.config.ts`**, **`capacitor.config.mjs`**
 * (у корені) **або** у будь-якому `package.json` (рекурсивно, з пропуском типових каталогів) оголошено
 * хоча б одну залежність **`@capacitor/…`** (у **`dependencies`**, **`devDependencies`**, опційно
 * **`optionalDependencies`**, **`peerDependencies`**).
 *
 * **Версія мінімум 8:** у кожному `package.json`, де вказано **`@capacitor/core`**, діапазон версії
 * мусить допускати лише **Capacitor 8+** (оцінка мінімального **major** з рядка діапазону npm, зокрема
 * `||` і діапазонів через `-` у спрощеному вигляді). **`*`**, **latest** та нерозпізнані випадки — **порушення**:
 * варто задати явний діапазон, наприклад **`^8.0.0`**. Якщо оголошено `capacitor.config.*` без жодного
 * **`@capacitor/core`** у дереві `package.json` — також помилка.
 *
 * **iOS:** зазвичай **без** **Podfile** поза **Pods** (тільки **SPM**). **@nitra/**-плагіни за політикою **SPM** —
 * їх **не** перелічуємо й **не** перевіряємо. Якщо **Podfile** є, його можна зареєструвати як **виняток**
 * (див. **capacitor.mdc**): у кореневому **`package.json`** або
 * **`capacitor.config.json` / `capacitor.config.ts` / `capacitor.config.mjs`**, об’єкт **nitra** з
 * **`iosCocoaPodsBecausePluginsLackSpm: true`** (або **`iosCocoaPodsAllowed: true`**); тоді **Podfile** **не** fail.
 * Якщо **`ios/`** **немає** — iOS-умови не застосовуються.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'

/** Мінімальна допустима мажорна версія Capacitor (capacitor.mdc) */
const MIN_CAPACITOR_MAJOR = 8

/** @type {Set<string>} */
const IGNORED_DIRS_FOR_PACKAGE_JSON = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'Pods',
  '.turbo',
  '.next',
  'build'
])

/** `||` у діапазоні npm-версій */
// eslint-disable-next-line sonarjs/slow-regex -- короткі **semver**-підрядки у **package.json**
const NPM_OR_PARTS_RE = /\s*\|\|\s*/

/** `a - b` (діапазон діапазонів) */
// eslint-disable-next-line sonarjs/slow-regex -- форма **X - Y** у **npm**-range
const NPM_HYPHEN_RANGE_RE = /^(.+?)\s+-\s+(.+)$/

const FIRST_VERSION_NUM_RE = /^(?:v)?(\d+)/i

const PREFIX_GEQ_RE = /^>=\s*/u
const PREFIX_GT_RE = /^>\s*/u
const STRIP_CARET_TILDE_EQ_RE = /^[=^~]+\s*/u

/**
 * Початок блока **nitra: {** у **.ts** / **.mjs** (**capacitor.config**; ключ **nitra**).
 */
const RE_NITRA_CONFIG_OBJECT_LEAD_IN = /\bnitra\b\s*:\s*\{|[\u0027"]nitra[\u0027"]\s*:\s*\{/

const RE_COCOAPODS_EXEMPT_SPM = /\biosCocoaPodsBecausePluginsLackSpm\s*:\s*true\b/
const RE_COCOAPODS_EXEMPT_ALLOW = /\biosCocoaPodsAllowed\s*:\s*true\b/

/**
 * Мінімальний **major** (нижня межа) для **однієї** OR-частини діапазону npm (без `||` всередині).
 * @param {string} segment одна частина після `||` або весь рядок
 * @returns {number | null} null, якщо **`*` / `x` / `latest`**, або **major** **нижньої** межі
 */
export function capacitorSegmentMinMajor(segment) {
  if (typeof segment !== 'string') {
    return null
  }
  const s0 = segment.trim()
  if (!s0) {
    return null
  }
  const low = s0.toLowerCase()
  if (s0 === '*' || low === 'x' || low === 'latest') {
    return null
  }
  if (s0.startsWith('<') || s0.startsWith('<=')) {
    return 0
  }
  if (s0.startsWith('>') && !s0.startsWith('>=')) {
    return firstVersionMajorFromNpmValue(s0.replace(PREFIX_GT_RE, ''))
  }
  const rangeHyphen = s0.match(NPM_HYPHEN_RANGE_RE)
  if (rangeHyphen) {
    return firstVersionMajorFromNpmValue(rangeHyphen[1].trim())
  }
  if (s0.startsWith('^') || s0.startsWith('~') || s0.startsWith('=')) {
    return firstVersionMajorFromNpmValue(s0.replace(STRIP_CARET_TILDE_EQ_RE, ''))
  }
  if (s0.startsWith('>=')) {
    return firstVersionMajorFromNpmValue(s0.replace(PREFIX_GEQ_RE, ''))
  }
  return firstVersionMajorFromNpmValue(s0)
}

/**
 * Витягує **major** з першого числа у вигляді **X** або **X.Y** / **X.Y.Z** (опційно **v**).
 * @param {string} t рядок ділянки **версії** (без префікса **операторів**)
 * @returns {number | null} перше **ціле** (major) або **null**
 */
function firstVersionMajorFromNpmValue(t) {
  const s = t.trim()
  if (!s) {
    return null
  }
  const m = s.match(FIRST_VERSION_NUM_RE)
  if (!m) {
    return null
  }
  return Number.parseInt(m[1], 10)
}

/**
 * Мінімальна можлива (нижня) **major**-версія для повного діапазону npm, у т. ч. з `||`.
 * @param {string} versionRange повне поле `package.json` для **@capacitor/core**
 * @returns {number | null} **null** якщо **`*` / latest** в одній з частин
 */
export function capacitorVersionRangeMinMajor(versionRange) {
  if (typeof versionRange !== 'string') {
    return null
  }
  const parts = versionRange.split(NPM_OR_PARTS_RE)
  let overallMin = /** @type {number | null} */ (null)
  for (const p of parts) {
    const m = capacitorSegmentMinMajor(p)
    if (m === null) {
      return null
    }
    if (overallMin === null || m < overallMin) {
      overallMin = m
    }
  }
  return overallMin
}

/**
 * @param {string} versionRange рядок **версії** з `package.json`
 * @param {number} [min] мінімальний **major** (за замовчуванням `MIN_CAPACITOR_MAJOR`)
 * @returns {boolean} **true**, якщо нижня межа **≥** **min**
 */
export function isCapacitorCoreVersionAtLeast8(versionRange, min = MIN_CAPACITOR_MAJOR) {
  const low = capacitorVersionRangeMinMajor(versionRange)
  if (low === null) {
    return false
  }
  return low >= min
}

/**
 * @param {(m: string) => void} fail друк помилки
 * @param {(m: string) => void} pass друк успіху
 * @param {string} rel відносний **posix**-шлях `package.json`
 * @param {string} range поле `version` для **@capacitor/core**
 * @returns {void}
 */
function reportOneCapacitorCoreRange(fail, pass, rel, range) {
  if (isCapacitorCoreVersionAtLeast8(range)) {
    pass(`«${rel}»: @capacitor/core — діапазон сумісний з ${MIN_CAPACITOR_MAJOR}+`)
  } else {
    fail(
      `«${rel}»: @capacitor/core «${range}» — мінімальна допустима мажорна версія Capacitor ${MIN_CAPACITOR_MAJOR} (capacitor.mdc). Вкажи, наприклад, ^${MIN_CAPACITOR_MAJOR}.0.0`
    )
  }
}

/**
 * @param {string} rel відносний шлях `package.json`
 * @param {Record<string, unknown>} obj `dependencies` / `devDependencies` / **…**
 * @param {{ byPath: Map<string, string>, anyCapacitor: boolean }} out накопичувач **@capacitor** у дереві
 */
function recordCapacitorFromDependencyObject(rel, obj, out) {
  for (const [name, val] of Object.entries(obj)) {
    if (typeof name === 'string' && name.startsWith('@capacitor/')) {
      out.anyCapacitor = true
    }
    if (name === '@capacitor/core' && typeof val === 'string' && val !== '') {
      out.byPath.set(rel, val)
    }
  }
}

/**
 * @param {string} absPath шлях до `package.json`
 * @param {string} root корінь репозиторію
 * @param {{ byPath: Map<string, string>, anyCapacitor: boolean }} out накопичувач **byPath** і **anyCapacitor**
 * @returns {Promise<void>}
 */
export async function recordCapacitorFromOnePackageJson(absPath, root, out) {
  let raw
  try {
    raw = await readFile(absPath, 'utf8')
  } catch {
    return
  }
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch {
    return
  }
  const rel = (relative(root, absPath) || absPath).replaceAll('\\', '/')
  for (const block of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const rec = pkg?.[block]
    if (rec !== null && rec !== undefined && typeof rec === 'object' && !Array.isArray(rec)) {
      recordCapacitorFromDependencyObject(rel, /** @type {Record<string, unknown>} */ (rec), out)
    }
  }
}

/**
 * Зчитує всі `package.json` з дерева, накопичує `byPath` і `anyCapacitor`.
 * @param {string} root корінь репозиторію
 * @param {{ byPath: Map<string, string>, anyCapacitor: boolean }} out накопичувач
 * @returns {Promise<void>}
 */
export async function collectCapacitorDataFromAllPackageJson(root, out) {
  out.anyCapacitor = false
  if (out.byPath) {
    out.byPath.clear()
  } else {
    out.byPath = new Map()
  }

  /**
   * @param {string} dir абсолютний **каталог** для `readdir`
   * @returns {Promise<void>}
   */
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absPath = join(dir, entry.name)
      if (entry.isDirectory() && !IGNORED_DIRS_FOR_PACKAGE_JSON.has(entry.name)) {
        await walk(absPath)
      } else if (entry.isFile() && entry.name === 'package.json') {
        await recordCapacitorFromOnePackageJson(absPath, root, out)
      }
    }
  }

  await walk(root)
}

/**
 * @param {string} root абсолютний або **cwd**-відносний **корінь** репозиторію
 * @returns {boolean} **true** якщо `capacitor.config.{json,ts,mjs}` існує
 */
export function hasCapacitorConfigInRoot(root) {
  return (
    existsSync(join(root, 'capacitor.config.json')) ||
    existsSync(join(root, 'capacitor.config.ts')) ||
    existsSync(join(root, 'capacitor.config.mjs'))
  )
}

/**
 * Чи варто застосовувати правила: конфіг **або** **@capacitor/** у залежностях.
 * @param {string} root корінь
 * @param {boolean} anyCapacitor чи зустрілось **@capacitor/** у **package.json**
 * @returns {boolean} **true** якщо застосовуємо **check capacitor**
 */
export function isCapacitorRelevantForCheck(root, anyCapacitor) {
  return hasCapacitorConfigInRoot(root) || anyCapacitor
}

/**
 * Рекурсивно шукає `Podfile` у **ios/**, **не** заходячи в **Pods** (кеш CocoaPods) і типові build-каталоги.
 * @param {string} root корінь репозиторію
 * @param {string} dir абсолютний каталог
 * @param {(rel: string) => void} onPodfileRelative **callback** з **posix**-шляхом `Podfile` від **root**
 * @returns {Promise<boolean>} **true** — знайдено **хоча б один** `Podfile`
 */
export async function walkIosForPodfileSkipPods(root, dir, onPodfileRelative) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    if (e.name === 'Pods' || e.name === 'build' || e.name === 'DerivedData') {
      // skip
    } else if (e.isFile() === true && e.name === 'Podfile') {
      const abs = join(dir, e.name)
      onPodfileRelative((relative(root, abs) || abs).replaceAll('\\', '/'))
      return true
    } else if (e.isDirectory() === true) {
      const abs = join(dir, e.name)
      const found = await walkIosForPodfileSkipPods(root, abs, onPodfileRelative)
      if (found === true) {
        return true
      }
    }
  }
  return false
}

/**
 * @param {string} root корінь
 * @returns {Promise<string | null>} **relative**-шлях `Podfile` (або **null**)
 */
export async function findFirstPodfileUnderIosExcludingPods(root) {
  const iosDir = join(root, 'ios')
  if (!existsSync(iosDir)) {
    return null
  }
  let first = /** @type {string | null} */ (null)
  await walkIosForPodfileSkipPods(root, iosDir, rel => {
    if (first === null || rel.length < first.length) {
      first = rel
    }
  })
  return first
}

/**
 * Чи дозволяє об’єкт **nitra** використання **Podfile** (CocoaPods) на iOS (див. **capacitor.mdc**; **@nitra/**
 * **SPM** **не** аналізуємо).
 * @param {unknown} o об’єкт **nitra** з **package.json** / **capacitor.config**
 * @returns {boolean} **true** якщо **Podfile** дозволено (один з прапорів **true**)
 */
export function nitrAObjectAllowsIosCocoaPods(o) {
  if (o === null || o === undefined || typeof o !== 'object' || Array.isArray(o)) {
    return false
  }
  const r = /** @type {Record<string, unknown>} */ (o)
  if (r.iosCocoaPodsBecausePluginsLackSpm === true) {
    return true
  }
  if (r.iosCocoaPodsAllowed === true) {
    return true
  }
  return false
}

/**
 * Витягає вихідний текст тіла **{ ... }** після **nitra:** / **"nitra":** у **config**-файлі (**ts** / **mjs**)
 * (перша відповідність, баланс фігурних дужок).
 * @param {string} source вміст **.ts** / **.mjs** config
 * @returns {string | null} фрагмент **`{...}`** після **nitra:** або **null**
 */
function extractNitraObjectBodySource(source) {
  const m = RE_NITRA_CONFIG_OBJECT_LEAD_IN.exec(source)
  if (!m) {
    return null
  }
  const openBrace = m.index + m[0].length - 1
  let d = 0
  for (let i = openBrace; i < source.length; i += 1) {
    const c = source[i]
    if (c === '{') {
      d += 1
    } else if (c === '}') {
      d -= 1
      if (d === 0) {
        return source.slice(openBrace, i + 1)
      }
    }
  }
  return null
}

/**
 * @param {string} objectBody фрагмент **`{ ... }`** (текст)
 * @returns {boolean} **true**, якщо в тілі є **iosCocoaPods**…**:** **true**
 */
function nitraObjectBodyStringAllowsCocoaPodsExempt(objectBody) {
  return RE_COCOAPODS_EXEMPT_SPM.test(objectBody) === true || RE_COCOAPODS_EXEMPT_ALLOW.test(objectBody) === true
}

/**
 * @param {string} absPath повний шлях до **JSON**-файла
 * @returns {Promise<boolean>} **true**, якщо `obj.nitra` (ключ **nitra** у JSON) — виняток
 */
async function pathJsonShowsNitraCocoapodsExempt(absPath) {
  if (existsSync(absPath) !== true) {
    return false
  }
  try {
    const t = await readFile(absPath, 'utf8')
    const j = /** @type {Record<string, unknown>} */ (JSON.parse(t))
    return nitrAObjectAllowsIosCocoaPods(j['nitra']) === true
  } catch {
    return false
  }
}

/**
 * @param {string} root корінь репозиторію
 * @returns {Promise<boolean>} **true**, якщо **.ts** / **.mjs** містить валідний виняток **nitra**
 */
async function capacitorConfigTsMjsNitraCocoapodsExempt(root) {
  for (const name of ['capacitor.config.ts', 'capacitor.config.mjs']) {
    const p = join(root, name)
    if (existsSync(p) === true) {
      const text = await readFile(p, 'utf8')
      const body = extractNitraObjectBodySource(text)
      if (body !== null && nitraObjectBodyStringAllowsCocoaPodsExempt(body) === true) {
        return true
      }
    }
  }
  return false
}

/**
 * @param {string} root корінь репозиторію (**process.cwd()** у **check**)
 * @returns {Promise<boolean>} **true** якщо **Podfile** виправдано **nitra**-конфігом
 */
async function isIosCocoaPodsExemptByNitraConfig(root) {
  if ((await pathJsonShowsNitraCocoapodsExempt(join(root, 'package.json'))) === true) {
    return true
  }
  if ((await pathJsonShowsNitraCocoapodsExempt(join(root, 'capacitor.config.json'))) === true) {
    return true
  }
  return capacitorConfigTsMjsNitraCocoapodsExempt(root)
}

/**
 * @returns {Promise<number>} **0** — **ok**; **1** — **fail** (див. **capacitor.mdc**)
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail, getExitCode } = reporter
  const root = process.cwd()

  const acc = { byPath: new Map(), anyCapacitor: false }
  await collectCapacitorDataFromAllPackageJson(root, acc)
  const { byPath, anyCapacitor } = acc

  if (!isCapacitorRelevantForCheck(root, anyCapacitor)) {
    pass(
      'Capacitor не виявлено (без capacitor.config у корені, без @capacitor/ у package.json) — check capacitor пропущено'
    )
    return getExitCode()
  }

  pass('Проєкт з ознаками Capacitor — застосовую capacitor.mdc')

  if (byPath.size === 0) {
    fail(
      `додай залежність @capacitor/core з діапазоном ^${MIN_CAPACITOR_MAJOR}.0.0 (або іншим, сумісним лише з ${MIN_CAPACITOR_MAJOR}+) у package.json (capacitor.mdc)`
    )
  } else {
    for (const [rel, range] of byPath) {
      reportOneCapacitorCoreRange(fail, pass, rel, range)
    }
  }

  const podfileRel = await findFirstPodfileUnderIosExcludingPods(root)
  if (podfileRel === null) {
    if (existsSync(join(root, 'ios'))) {
      pass('ios/ без Podfile поза Pods/ (лише SPM, capacitor.mdc)')
    } else {
      pass('каталог ios/ не знайдено — вимогу iOS/SPM пропущено')
    }
  } else if ((await isIosCocoaPodsExemptByNitraConfig(root)) === true) {
    pass(
      `iOS: Podfile «${podfileRel}» — дозволено виняток (nitra.iosCocoaPodsBecausePluginsLackSpm / iosCocoaPodsAllowed, capacitor.mdc)`
    )
  } else {
    fail(
      `iOS: знайдено Podfile «${podfileRel}» — для Capacitor використовуй лише SPM, без CocoaPods, або додай виняток nitra (capacitor.mdc)`
    )
  }

  return getExitCode()
}
