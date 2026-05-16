/**
 * Перевіряє, що в кожному workspace із незакомічаними/незрелізнутими змінами підвищена `version` у
 * `<ws>/package.json` і в `<ws>/CHANGELOG.md` присутній запис `## [version] - YYYY-MM-DD`
 * (формат Keep a Changelog).
 *
 * Дві моделі визначення «бази для порівняння» — на рівні воркспейсу:
 *
 * 1) **npm-published mode** (`<ws>/package.json` має непорожнє `name`, не `private: true`,
 *    і має масив `files`): база = опублікована версія в npm-реєстрі (`npm view <name> version`).
 *    Git не задіяний. Якщо локальна версія відрізняється від опублікованої — потрібен запис
 *    у CHANGELOG для локальної версії й `"CHANGELOG.md"` у `files`. Якщо `npm view` недосяжний
 *    (немає мережі / пакет ще не публікувався) — fail-safe pass із поясненням, щоб локальна
 *    розробка офлайн не блокувалась.
 *
 * 2) **local-only mode** (приватні / без `files` воркспейси): PR-scoped перевірка проти `dev`.
 *    База = `git merge-base <dev> HEAD` (точка розгалуження поточної гілки від `dev`), щоб:
 *    - на feature-гілці бачити лише унікальні коміти цієї гілки;
 *    - на `main` після merge `dev → main` diff був порожній (нічого не вимагати);
 *    - direct-commit на `main` поза PR-flow ловився як зміна, що потребує bump + CHANGELOG.
 *    Якщо не git-репо, поточна гілка = `dev`, або `dev`/`origin/dev` не існує — пропуск.
 *
 * Усі `git` і `npm` виклики — через `execFile`, без shell-інтерполяції.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { getMonorepoPackageRootDirs } from '../../../../scripts/utils/workspaces.mjs'

const execFileAsync = promisify(execFile)

/** Базова гілка PR — фіксована, без конфіга (див. n-changelog.mdc) */
const BASE_BRANCH = 'dev'

/** Таймаут на `npm view <name> version` (мс), щоб не блокуватись на офлайні */
const NPM_VIEW_TIMEOUT_MS = 10_000

/**
 * Тихо запускає `git` і повертає stdout або `null` при будь-якій помилці.
 * @param {string[]} args аргументи `git`
 * @returns {Promise<string | null>} stdout процесу або `null` при будь-якій помилці виконання
 */
async function gitOrNull(args) {
  try {
    const { stdout } = await execFileAsync('git', args)
    return stdout
  } catch {
    return null
  }
}

/**
 * Чи робочий каталог — git-репозиторій.
 * @returns {Promise<boolean>} `true`, якщо `git rev-parse --is-inside-work-tree` повернув `true`
 */
async function isInsideGitRepo() {
  const out = await gitOrNull(['rev-parse', '--is-inside-work-tree'])
  return typeof out === 'string' && out.trim() === 'true'
}

/**
 * Назва поточної гілки (або `HEAD` для detached state).
 * @returns {Promise<string | null>} назва гілки чи `'HEAD'`, або `null` (поза git / помилка)
 */
async function currentBranchName() {
  const out = await gitOrNull(['rev-parse', '--abbrev-ref', 'HEAD'])
  return typeof out === 'string' ? out.trim() : null
}

/**
 * Знаходить ref для базової гілки. Перевага локальному `dev`, далі `origin/dev`. Повертає `null`,
 * якщо жоден не існує.
 * @returns {Promise<string | null>} назва ref-а (`dev` чи `origin/dev`) або `null`, якщо жоден не знайдено
 */
async function resolveBaseRef() {
  for (const ref of [BASE_BRANCH, `origin/${BASE_BRANCH}`]) {
    const out = await gitOrNull(['rev-parse', '--verify', '--quiet', ref])
    if (typeof out === 'string' && out.trim().length > 0) {
      return ref
    }
  }
  return null
}

/**
 * Точка розгалуження поточної гілки від `baseRef`. На feature-гілці = коли вона відгалузилась;
 * на `main` після merge `dev → main` = поточний `dev`. Повертає `null`, якщо merge-base нема.
 * @param {string} baseRef SHA або ref-name бази (зазвичай `dev` / `origin/dev`)
 * @returns {Promise<string | null>} SHA точки розгалуження або `null`, якщо merge-base нема
 */
async function resolveMergeBase(baseRef) {
  const out = await gitOrNull(['merge-base', baseRef, 'HEAD'])
  if (typeof out !== 'string') return null
  const sha = out.trim()
  return sha.length > 0 ? sha : null
}

/**
 * Будує pathspec для `git diff` / `ls-files` для воркспейсу.
 *
 * Для кореня `.` — це точка плюс magic-виключення кожного підворкспейсу через `:(exclude)<sub>/`,
 * щоб зміни всередині sub-workspace не вважалися змінами кореня.
 * Для звичайного воркспейсу — просто `<ws>/`.
 * @param {string} ws шлях воркспейсу (`'.'` для кореня, інакше — відносний шлях, як у `workspaces`)
 * @param {string[]} subWorkspaces усі під-воркспейси (зокрема для `'.'` потрібно виключити їх)
 * @returns {string[]} pathspec для git: масив, що передається після `--`
 */
function pathspecForWorkspace(ws, subWorkspaces) {
  if (ws !== '.') return [`${ws}/`]
  return ['.', ...subWorkspaces.filter(s => s !== '.').map(s => `:(exclude)${s}/`)]
}

/**
 * Чи є зміни (committed або в робочому дереві) у каталозі `<ws>` відносно `baseRef`.
 *
 * `git diff --quiet <baseRef> -- <pathspec>` ловить committed-зміни на цій гілці й незбережені
 * правки tracked-файлів. Untracked-файли — `git ls-files --others --exclude-standard`.
 * @param {string} baseRef SHA або ref-name (зокрема merge-base)
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @param {string[]} subWorkspaces усі під-воркспейси для коректного формування pathspec кореня
 * @returns {Promise<boolean>} `true`, якщо в межах воркспейсу є будь-які зміни (committed або untracked)
 */
async function workspaceHasChangesAgainstBase(baseRef, ws, subWorkspaces) {
  const pathspec = pathspecForWorkspace(ws, subWorkspaces)
  try {
    await execFileAsync('git', ['diff', '--quiet', baseRef, '--', ...pathspec])
  } catch (error) {
    const code = /** @type {{ code?: number }} */ (error).code
    return code === 1
  }
  const untracked = await gitOrNull(['ls-files', '--others', '--exclude-standard', '--', ...pathspec])
  return typeof untracked === 'string' && untracked.trim().length > 0
}

/**
 * Версія з `<ws>/package.json` на `baseRef` або `null`.
 * @param {string} baseRef SHA або ref-name (зазвичай merge-base) для `git show`
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @returns {Promise<string | null>} значення поля `version` або `null`, якщо файла нема / JSON некоректний
 */
async function readBaseVersion(baseRef, ws) {
  const wsPath = ws === '.' ? 'package.json' : `${ws}/package.json`
  const out = await gitOrNull(['show', `${baseRef}:${wsPath}`])
  if (out === null) return null
  try {
    const parsed = JSON.parse(out)
    return typeof parsed?.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Чи містить текст `CHANGELOG.md` запис `## [version]` (з опційним `- YYYY-MM-DD`).
 * @param {string} text вміст CHANGELOG.md
 * @param {string} version версія, яку шукаємо у форматі Keep a Changelog
 * @returns {boolean} `true`, якщо запис для `version` знайдено
 */
function changelogHasVersionEntry(text, version) {
  const needle = `## [${version}]`
  return text.startsWith(needle) || text.includes(`\n${needle}`)
}

/**
 * Зчитує `<ws>/package.json`. `null`, якщо файл відсутній або JSON некоректний.
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @returns {Promise<Record<string, unknown> | null>} розпарсений `package.json` або `null`
 */
async function readPackageJsonOrNull(ws) {
  const path = join(ws, 'package.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null
  } catch {
    return null
  }
}

/**
 * Воркспейс публікується в npm: має непорожній `name`, не `private: true`, і має масив `files`.
 * @param {Record<string, unknown> | null} pkg розпарсений `package.json` (або `null`)
 * @returns {boolean} `true`, якщо пакет придатний для публікації в npm
 */
function isNpmPublishable(pkg) {
  if (!pkg) return false
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) return false
  if (pkg.private === true) return false
  return Array.isArray(pkg.files)
}

/**
 * Опублікована версія пакета в npm-реєстрі. `null` — пакет не знайдено / нема мережі / помилка.
 * Дефолтна імплементація — `npm view <name> version` із таймаутом, щоб не блокуватись офлайн.
 * @param {string} name повна назва пакета (включно зі скоупом)
 * @returns {Promise<string | null>} опублікована версія або `null` (нема пакета / офлайн)
 */
async function defaultGetPublishedVersion(name) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', name, 'version'], { timeout: NPM_VIEW_TIMEOUT_MS })
    const v = stdout.trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * Перевіряє масив `files` у `<ws>/package.json`: якщо оголошено — має містити `"CHANGELOG.md"`.
 * @param {Record<string, unknown> | null} pkg розпарсений `package.json` воркспейсу
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
function checkFilesArrayContainsChangelog(pkg, ws, pass, fail) {
  if (!pkg || !Array.isArray(pkg.files)) return
  const pkgPath = join(ws, 'package.json')
  if (pkg.files.includes('CHANGELOG.md')) {
    pass(`${pkgPath}: files містить "CHANGELOG.md"`)
  } else {
    fail(`${pkgPath}: масив files має містити "CHANGELOG.md", щоб публікувати changelog із пакетом`)
  }
}

/**
 * Перевіряє наявність запису у `<ws>/CHANGELOG.md` для версії `version`.
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @param {string} version версія, для якої очікується запис
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<boolean>} `false`, якщо файл відсутній або немає запису
 */
async function verifyChangelogEntry(ws, version, pass, fail) {
  const label = ws === '.' ? '<root>' : ws
  const changelogPath = join(ws, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) {
    fail(`${label}: відсутній ${changelogPath} (Keep a Changelog, див. n-changelog.mdc)`)
    return false
  }
  const text = await readFile(changelogPath, 'utf8')
  if (changelogHasVersionEntry(text, version)) {
    pass(`${changelogPath}: знайдено запис для версії ${version}`)
    return true
  }
  fail(`${changelogPath}: відсутній запис для ${version} (формат "## [${version}] - YYYY-MM-DD")`)
  return false
}

/**
 * npm-published режим: порівнює локальну `version` з опублікованою в реєстрі. Якщо вони
 * відрізняються — вимагає запис у CHANGELOG і `"CHANGELOG.md"` у `files`. Якщо реєстр недосяжний,
 * правило fail-safe пасує (щоб офлайн-розробка не блокувалась).
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @param {Record<string, unknown>} pkg розпарсений `package.json` воркспейсу
 * @param {(name: string) => Promise<string | null>} getPublishedVersion стаб/реальна функція отримання опублікованої версії
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkPublishedWorkspace(ws, pkg, getPublishedVersion, pass, fail) {
  const label = ws === '.' ? '<root>' : ws
  const Vcurrent = typeof pkg.version === 'string' ? pkg.version : null
  if (!Vcurrent) {
    fail(`${label}: у package.json відсутнє поле version (npm-published воркспейс)`)
    return
  }
  const name = /** @type {string} */ (pkg.name)
  const Vpublished = await getPublishedVersion(name)
  if (Vpublished === null) {
    pass(`${label}: ${name} — опублікована версія недоступна (мережа/реєстр), перевірку пропущено`)
    return
  }
  if (Vpublished === Vcurrent) {
    pass(`${label}: ${name}@${Vcurrent} вже опубліковано — змін до релізу немає`)
    return
  }
  pass(`${label}: ${name} — нова локальна версія (${Vpublished} → ${Vcurrent})`)
  await verifyChangelogEntry(ws, Vcurrent, pass, fail)
  checkFilesArrayContainsChangelog(pkg, ws, pass, fail)
}

/**
 * local-only режим: PR-scoped перевірка проти `dev` через `git merge-base`. Викликається лише
 * для воркспейсів, де є реальні зміни щодо merge-base.
 * @param {string} mergeBase SHA точки розгалуження
 * @param {string} ws шлях воркспейсу (`'.'` для кореня)
 * @param {Record<string, unknown> | null} pkg розпарсений `package.json` воркспейсу (або `null`)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkLocalOnlyChangedWorkspace(mergeBase, ws, pkg, pass, fail) {
  const label = ws === '.' ? '<root>' : ws
  const Vcurrent = typeof pkg?.version === 'string' ? pkg.version : null
  if (!Vcurrent) {
    fail(`${label}: у package.json відсутнє поле version (потрібне для запису в CHANGELOG)`)
    return
  }
  const Vbase = await readBaseVersion(mergeBase, ws)
  if (Vbase !== null && Vbase === Vcurrent) {
    fail(
      `${label}: у цій гілці є зміни, але version у ${join(ws, 'package.json')} не підвищено (на ${BASE_BRANCH} — ${Vbase}). Bump + запис у CHANGELOG.md обов'язкові на PR`
    )
    return
  }
  pass(`${label}: version підвищено (${Vbase ?? '∅'} → ${Vcurrent})`)
  if (!(await verifyChangelogEntry(ws, Vcurrent, pass, fail))) return
  checkFilesArrayContainsChangelog(pkg, ws, pass, fail)
}

/**
 * Виконує local-only перевірку для всіх workspace-ів, у яких немає npm-published режиму.
 * @param {string[]} localOnlyWorkspaces список шляхів local-only воркспейсів
 * @param {Map<string, Record<string, unknown> | null>} pkgByWs мапа: шлях воркспейсу → розпарсений `package.json` (або `null`)
 * @param {string[]} subWorkspaces усі під-воркспейси (для коректного pathspec кореня)
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>} резолвиться по завершенню перевірок усіх local-only воркспейсів
 */
async function runLocalOnlyChecks(localOnlyWorkspaces, pkgByWs, subWorkspaces, pass, fail) {
  if (localOnlyWorkspaces.length === 0) return

  if (!(await isInsideGitRepo())) {
    pass('changelog: не git-репозиторій — local-only перевірку пропущено')
    return
  }
  const branch = await currentBranchName()
  if (branch === BASE_BRANCH) {
    pass(`changelog: поточна гілка = ${BASE_BRANCH} — local-only перевірку пропущено`)
    return
  }
  const baseRef = await resolveBaseRef()
  if (!baseRef) {
    pass(`changelog: ref ${BASE_BRANCH} (та origin/${BASE_BRANCH}) не знайдено — local-only перевірку пропущено`)
    return
  }
  const mergeBase = await resolveMergeBase(baseRef)
  if (!mergeBase) {
    pass(`changelog: merge-base з ${baseRef} не знайдено — local-only перевірку пропущено`)
    return
  }

  let checkedAny = false
  for (const ws of localOnlyWorkspaces) {
    if (!(await workspaceHasChangesAgainstBase(mergeBase, ws, subWorkspaces))) continue
    checkedAny = true
    await checkLocalOnlyChangedWorkspace(mergeBase, ws, pkgByWs.get(ws) ?? null, pass, fail)
  }
  if (!checkedAny) {
    pass(`changelog: local-only воркспейси без змін відносно merge-base(${baseRef})`)
  }
}

/**
 * Перевіряє відповідність проєкту правилу changelog.mdc.
 * @param {object} [opts] опції перевірки
 * @param {(name: string) => Promise<string | null>} [opts.getPublishedVersion] перевизначення для тестів
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(opts = {}) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const getPublishedVersion = opts.getPublishedVersion ?? defaultGetPublishedVersion

  const workspaces = await getMonorepoPackageRootDirs(process.cwd())
  const subWorkspaces = workspaces.filter(w => w !== '.')

  /** @type {Map<string, Record<string, unknown> | null>} */
  const pkgByWs = new Map()
  /** @type {string[]} */
  const publishedWorkspaces = []
  /** @type {string[]} */
  const localOnlyWorkspaces = []
  for (const ws of workspaces) {
    const pkg = await readPackageJsonOrNull(ws)
    pkgByWs.set(ws, pkg)
    if (isNpmPublishable(pkg)) {
      publishedWorkspaces.push(ws)
    } else {
      localOnlyWorkspaces.push(ws)
    }
  }

  for (const ws of publishedWorkspaces) {
    await checkPublishedWorkspace(
      ws,
      /** @type {Record<string, unknown>} */ (pkgByWs.get(ws)),
      getPublishedVersion,
      pass,
      fail
    )
  }

  await runLocalOnlyChecks(localOnlyWorkspaces, pkgByWs, subWorkspaces, pass, fail)

  return reporter.getExitCode()
}
