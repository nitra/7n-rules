/**
 * Делта-вимір per-file line coverage для концерну `coverage` правила `test`
 * (spec 2026-07-22 absorb-7n-test): легкий шлях без мутаційного тестування —
 * лише покриття рядків змінених JS/TS-файлів через project-local vitest
 * (`bunx vitest`, як у js-collector; bundled-vitest shim `@7n/test` не
 * переносився — vitest має бути devDependency цільового проєкту, test.mdc).
 *
 * `.vue` у делті не гейтиться: його покриття рахує browser-mode Storybook-вимір,
 * який у делті свідомо не запускається (Playwright — не для швидкого шляху).
 * Файли, яким тести не потрібні (`quickClassify` → needsTests:false),
 * виключаються; неоднозначні (null) лишаються в гейті консервативно.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

import { defaultRunner } from './js-collector.mjs'
import { quickClassify } from './lib/quick-classify.mjs'
import { resolveAllJsRoots } from './lib/resolve-js-root.mjs'

/** JS/TS-джерела делта-гейта (без `.vue` — Storybook-вимір). */
const DELTA_SOURCE_RE = /\.[cm]?[jt]sx?$/
/** Тест-файли/сторі — вимірюються, але не гейтяться як джерела. */
const NON_SOURCE_RE = /\.(test|spec)\.[^.]+$|(?:^|[/\\])tests?[/\\]|\.stories\.[^.]+$/
/** Конфіг-файли тулінгу — не unit-тестовні джерела. */
const CONFIG_FILE_RE =
  /^(?:vitest|jest|eslint|prettier|stryker|babel|webpack|vite|rollup|oxfmt|tsconfig|jsconfig|knip)\.config\./
/** Тест-файли під не-vitest runner (bun:test) — їх падіння не чиняться fix-шляхом. */
const VITEST_UNSUPPORTED_TEST_RE = /bun:test|Cannot find package 'bun/i
/**
 * Сегмент шляху, що починається з крапки (прихована тека/файл) — не source
 * колектора (порт фіксу `@7n/test` 0.17.2-3): страхує від тестів/файлів
 * вкладених робочих дерев (`.claude/worktrees/**`, `.worktrees/**`).
 */
const HIDDEN_PATH_RE = /(^|[/\\])\./
/**
 * Test-discovery exclude прихованих тек (порт фіксу `@7n/test` 0.17.2-3): без
 * нього vitest ЗАПУСКАЄ тести вкладених робочих дерев. CLI `--exclude`, на
 * відміну від `--coverage.exclude`, ДОДАЄ патерн до test.exclude (не замінює
 * масив) — custom test.exclude конфіга проєкту лишається чинним.
 */
const TEST_DISCOVERY_EXCLUDE_ARG = '--exclude=**/.*/**'
/** Стеля помилок на файл у parseFailingTests. */
const MAX_ERRORS_PER_FILE = 5
/** Стеля рядків одного повідомлення помилки у parseFailingTests. */
const MAX_ERROR_LINES = 10

/**
 * Чи декларує package.json vitest (dependencies або devDependencies).
 * @param {{dependencies?: Record<string,string>, devDependencies?: Record<string,string>}} pkg package.json
 * @returns {boolean} true якщо vitest оголошено
 */
function hasVitestDep(pkg) {
  return Boolean(pkg.devDependencies?.vitest) || Boolean(pkg.dependencies?.vitest)
}

/**
 * Парс lcov.info у per-file рядки (`SF:`/`LF:`/`LH:`).
 * @param {string} text вміст lcov.info
 * @returns {Array<{file: string, pct: number, linesFound: number, linesCovered: number}>} per-file coverage
 */
export function parseLcovPerFile(text) {
  const files = []
  let currentFile = null
  let lf = 0
  let lh = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3).trim()
      lf = 0
      lh = 0
    } else if (line.startsWith('LF:')) {
      lf = Number(line.slice(3))
    } else if (line.startsWith('LH:')) {
      lh = Number(line.slice(3))
    } else if (line === 'end_of_record' && currentFile) {
      files.push({
        file: currentFile,
        pct: lf === 0 ? 100 : Math.round((lh / lf) * 10000) / 100,
        linesFound: lf,
        linesCovered: lh
      })
      currentFile = null
    }
  }
  return files
}

/**
 * Парсить JSON-звіт vitest у список падаючих тест-файлів з короткими помилками
 * (вхід fix-шляху `fix/fix-tests.mjs`; перенесено з coverage-per-file `@7n/test`).
 * @param {string} jsonPath шлях до JSON-результатів vitest
 * @param {string} dir корінь проєкту (для відносних шляхів)
 * @returns {Array<{file: string, errors: string[]}>} падаючі тест-файли з помилками
 */
export function parseFailingTests(jsonPath, dir) {
  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
    return (
      (data.testResults ?? [])
        .filter(r => r.status === 'failed')
        .map(r => {
          const assertionErrors = (r.assertionResults ?? [])
            .filter(a => a.status === 'failed')
            .slice(0, MAX_ERRORS_PER_FILE)
            .map(a => {
              const name = [...(a.ancestorTitles ?? []), a.title].join(' > ')
              const msg = (a.failureMessages?.[0] ?? '').split('\n').slice(0, MAX_ERROR_LINES).join('\n')
              return `${name}:\n${msg}`
            })
          // Module-level помилки (import/syntax) не мають assertionResults
          const errors =
            assertionErrors.length > 0
              ? assertionErrors
              : [
                  `Suite error: ${(r.message ?? r.failureMessage ?? 'module-level failure').split('\n').slice(0, MAX_ERROR_LINES).join('\n')}`
                ]
          return { file: relative(dir, r.testFilePath ?? r.name), errors }
        })
        .filter(f => !f.file.startsWith('..'))
        // Тести під прихованими теками (вкладені робочі дерева тощо) — не наші для фіксу
        .filter(f => !HIDDEN_PATH_RE.test(f.file))
        // Тест-файли під не-vitest runner (bun:test, jest) падають очікувано —
        // fix-шлях їх не чинить, тож у список не потрапляють.
        .filter(f => f.errors.every(e => !VITEST_UNSUPPORTED_TEST_RE.test(e)))
    )
  } catch {
    return []
  }
}

/**
 * Чи файл — кандидат делта-гейта (JS/TS-джерело, не тест/сторі/конфіг/декларація).
 * @param {string} rel відносний шлях
 * @returns {boolean} true — гейтиться
 */
function isGateCandidate(rel) {
  if (!DELTA_SOURCE_RE.test(rel)) return false
  if (NON_SOURCE_RE.test(rel)) return false
  if (rel.endsWith('.d.ts') || rel.endsWith('.d.mts')) return false
  const base = rel.split('/').pop() ?? rel
  return !CONFIG_FILE_RE.test(base)
}

/**
 * Файли делта-скоупу, що належать одному jsRoot (relative до нього).
 * @param {string[]} files змінені файли relative до cwd
 * @param {string} cwd корінь проєкту
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {string[]} кандидати гейта під цим root-ом
 */
function scopeGateFiles(files, cwd, jsRoot) {
  const out = []
  for (const f of files) {
    if (!isGateCandidate(f)) continue
    const rel = relative(jsRoot, join(cwd, f))
    if (rel.startsWith('..') || isAbsolute(rel)) continue
    out.push(rel)
  }
  return out
}

/**
 * Мапить per-file lcov-рядки root-а у делта-рядки гейта (relative до cwd),
 * відсіюючи файли, яким тести не потрібні (`quickClassify`).
 * @param {Array<{file: string, pct: number, linesFound: number, linesCovered: number}>} perFile lcov-рядки
 * @param {Set<string>} wanted запитані файли (relative до jsRoot)
 * @param {string} cwd корінь проєкту
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {Array<{file: string, pct: number, linesFound: number, linesCovered: number, reason?: string}>} рядки гейта
 */
function toGateRows(perFile, wanted, cwd, jsRoot) {
  const rows = []
  for (const row of perFile) {
    const rel = isAbsolute(row.file) ? relative(jsRoot, row.file) : row.file
    if (!wanted.has(rel)) continue
    const abs = join(jsRoot, rel)
    const verdict = existsSync(abs) ? quickClassify(readFileSync(abs, 'utf8')) : null
    if (verdict?.needsTests === false) continue
    rows.push({ ...row, file: relative(cwd, abs), ...(verdict?.reason && { reason: verdict.reason }) })
  }
  return rows
}

/**
 * Вимір одного jsRoot: scoped vitest-прогін → parseLcovPerFile → рядки гейта.
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @param {string} cwd корінь проєкту
 * @param {string[]} rootFiles кандидати гейта (relative до jsRoot)
 * @param {typeof defaultRunner} runner spawn-інʼєкція
 * @returns {Promise<Array<{file: string, pct: number, linesFound: number, linesCovered: number, reason?: string}>>} рядки гейта root-а
 */
async function collectRootRows(jsRoot, cwd, rootFiles, runner) {
  const lcovDir = await mkdtemp(join(tmpdir(), 'delta-cov-'))
  try {
    const code = await runner.runJsCoverage({
      cwd: jsRoot,
      lcovDir,
      excludeStorybookProject: true,
      extraArgs: [...rootFiles.map(f => `--coverage.include=${f}`), TEST_DISCOVERY_EXCLUDE_ARG]
    })
    if (code !== 0) throw new Error(`delta coverage: vitest exit ${code} (root ${relative(cwd, jsRoot) || '.'})`)
    const lcovPath = join(lcovDir, 'lcov.info')
    if (!existsSync(lcovPath)) return []
    const perFile = parseLcovPerFile(await readFile(lcovPath, 'utf8'))
    return toGateRows(perFile, new Set(rootFiles), cwd, jsRoot)
  } finally {
    await rm(lcovDir, { recursive: true, force: true })
  }
}

/**
 * Міряє per-file line coverage змінених файлів по всіх JS-roots проєкту.
 * Прогін suite повний (`--passWithNoTests`), але lcov обмежено зміненими
 * файлами через `--coverage.include` — файли без жодного тесту зʼявляються
 * в lcov з 0% (vitest 4: явний include замість прибраного `coverage.all`).
 * @param {string} cwd корінь проєкту
 * @param {{files: string[], runner?: typeof defaultRunner}} opts змінені файли (relative до cwd) + spawn-інʼєкція
 * @returns {Promise<Array<{file: string, pct: number, linesFound: number, linesCovered: number, reason?: string}>>} рядки по файлах-кандидатах (relative до cwd)
 */
export async function collectPerFile(cwd, opts) {
  const runner = opts.runner ?? defaultRunner
  const jsRoots = await resolveAllJsRoots(cwd)
  const rows = []
  // Workspace-monorepo з hoisted node_modules: vitest типово декларується лише
  // в кореневому package.json — тоді vitest-capable всі roots (як у detect()).
  const rootPkgPath = join(cwd, 'package.json')
  const rootHasVitest = existsSync(rootPkgPath) && hasVitestDep(JSON.parse(readFileSync(rootPkgPath, 'utf8')))

  for (const jsRoot of jsRoots) {
    const rootFiles = scopeGateFiles(opts.files, cwd, jsRoot)
    if (rootFiles.length === 0) continue

    // package.json без vitest (і без hoisted vitest у корені) → root не
    // вимірюється делтою (детект full-шляху підкаже hint; тут тихий skip,
    // щоб не гейтити не-vitest воркспейси).
    const pkgPath = join(jsRoot, 'package.json')
    if (!existsSync(pkgPath)) continue
    if (!rootHasVitest && !hasVitestDep(JSON.parse(readFileSync(pkgPath, 'utf8')))) continue

    rows.push(...(await collectRootRows(jsRoot, cwd, rootFiles, runner)))
  }

  return rows
}
