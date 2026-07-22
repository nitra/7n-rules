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
const DELTA_SOURCE_RE = /\.(c|m)?[jt]sx?$/
/** Тест-файли/сторі — вимірюються, але не гейтяться як джерела. */
const NON_SOURCE_RE = /\.(test|spec)\.[^.]+$|(?:^|[/\\])tests?[/\\]|\.stories\.[^.]+$/
/** Конфіг-файли тулінгу — не unit-тестовні джерела. */
const CONFIG_FILE_RE =
  /^(?:vitest|jest|eslint|prettier|stryker|babel|webpack|vite|rollup|oxfmt|tsconfig|jsconfig|knip)\.config\./

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
    const rootFiles = []
    for (const f of opts.files) {
      if (!isGateCandidate(f)) continue
      const rel = relative(jsRoot, join(cwd, f))
      if (rel.startsWith('..') || isAbsolute(rel)) continue
      rootFiles.push(rel)
    }
    if (rootFiles.length === 0) continue

    // package.json без vitest (і без hoisted vitest у корені) → root не
    // вимірюється делтою (детект full-шляху підкаже hint; тут тихий skip,
    // щоб не гейтити не-vitest воркспейси).
    const pkgPath = join(jsRoot, 'package.json')
    if (!existsSync(pkgPath)) continue
    if (!rootHasVitest && !hasVitestDep(JSON.parse(readFileSync(pkgPath, 'utf8')))) continue

    const lcovDir = await mkdtemp(join(tmpdir(), 'delta-cov-'))
    try {
      const includeArgs = rootFiles.map(f => `--coverage.include=${f}`)
      const code = await runner.runJsCoverage({
        cwd: jsRoot,
        lcovDir,
        excludeStorybookProject: true,
        extraArgs: includeArgs
      })
      if (code !== 0) throw new Error(`delta coverage: vitest exit ${code} (root ${relative(cwd, jsRoot) || '.'})`)
      const lcovPath = join(lcovDir, 'lcov.info')
      if (!existsSync(lcovPath)) continue
      const perFile = parseLcovPerFile(await readFile(lcovPath, 'utf8'))
      const wanted = new Set(rootFiles)
      for (const row of perFile) {
        const rel = isAbsolute(row.file) ? relative(jsRoot, row.file) : row.file
        if (!wanted.has(rel)) continue
        const abs = join(jsRoot, rel)
        const verdict = existsSync(abs) ? quickClassify(readFileSync(abs, 'utf8')) : null
        if (verdict?.needsTests === false) continue
        rows.push({ ...row, file: relative(cwd, abs), ...(verdict?.reason ? { reason: verdict.reason } : {}) })
      }
    } finally {
      await rm(lcovDir, { recursive: true, force: true })
    }
  }

  return rows
}
