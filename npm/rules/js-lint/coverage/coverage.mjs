/**
 * JS-провайдер для `n-cursor coverage`: збирає метрики покриття (`vitest run --coverage`)
 * і мутаційного тестування (Stryker з vitest-runner + perTest) для JS/TS коду.
 * Активується через `js-lint` правило в `.n-cursor.json#rules`; реальна applies-логіка
 * — у `detect(cwd)`.
 *
 * Контракт провайдера — у docs/superpowers/specs/2026-05-24-coverage-rule-design.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { resolveAllJsRoots } from '../../../scripts/utils/resolve-js-root.mjs'

const TEST_BLOCK_START = /^\s*(it|test)\(/
const FILE_EXTENSION = /\.[^.]+$/
const VITEST_HINT =
  'js-lint coverage: vitest відсутній у package.json — додай `vitest`, `@vitest/coverage-v8` та `@stryker-mutator/vitest-runner` у devDependencies (див. test.mdc)'

/**
 * Чи у пакеті встановлено vitest (через dependencies або devDependencies).
 * @param {{dependencies?: Record<string,string>, devDependencies?: Record<string,string>}} pkg package.json
 * @returns {boolean} true, якщо `vitest` декларовано хоча б в одному dep-section
 */
function hasVitestDep(pkg) {
  return Boolean(pkg.devDependencies?.vitest) || Boolean(pkg.dependencies?.vitest)
}

/**
 * Чи провайдер застосовний у поточному cwd. Активується, коли `vitest`
 * декларовано хоча б в одному JS-root АБО у кореневому `package.json`
 * (workspace-проєкт із hoisted node_modules — типовий патерн bun monorepo,
 * де npm-module rule забороняє devDeps у published workspace-у, тож вони
 * живуть у корені). Інакше silent skip із hint у stderr (одноразово).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<boolean>} true, якщо проєкт сумісний з vitest-based coverage
 */
export async function detect(cwd) {
  const jsRoots = await resolveAllJsRoots(cwd)
  if (jsRoots.length === 0) return false
  for (const jsRoot of jsRoots) {
    const pkgPath = join(jsRoot, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    if (hasVitestDep(pkg)) return true
  }
  const rootInJsRoots = jsRoots.includes(cwd)
  if (!rootInJsRoots) {
    const rootPkgPath = join(cwd, 'package.json')
    if (existsSync(rootPkgPath)) {
      const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
      if (hasVitestDep(rootPkg)) return true
    }
  }
  if (!detect._hinted) {
    console.error(VITEST_HINT)
    detect._hinted = true
  }
  return false
}

/**
 * Парс lcov.info: сумує LF/LH (рядки) і FNF/FNH (функції) по всіх records.
 * @param {string} text вміст lcov.info
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} агреговані totals
 */
function parseLcov(text) {
  const acc = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) acc.lines.total += Number(line.slice(3))
    else if (line.startsWith('LH:')) acc.lines.covered += Number(line.slice(3))
    else if (line.startsWith('FNF:')) acc.functions.total += Number(line.slice(4))
    else if (line.startsWith('FNH:')) acc.functions.covered += Number(line.slice(4))
  }
  return acc
}

/**
 * Витягує оригінальний фрагмент коду з рядків файлу за позицією мутанта.
 * @param {string[]} fileLines рядки файлу (0-indexed)
 * @param {{start:{line:number,column:number},end:{line:number,column:number}}} loc позиція (рядки 1-indexed)
 * @returns {string} оригінальний текст мутанта
 */
function extractOriginal(fileLines, loc) {
  const startLine = loc.start.line - 1
  const endLine = loc.end.line - 1
  if (startLine === endLine) {
    return fileLines[startLine]?.slice(loc.start.column, loc.end.column) ?? ''
  }
  const parts = []
  for (let i = startLine; i <= endLine; i++) {
    const line = fileLines[i] ?? ''
    if (i === startLine) parts.push(line.slice(loc.start.column))
    else if (i === endLine) parts.push(line.slice(0, loc.end.column))
    else parts.push(line)
  }
  return parts.join('\n')
}

/**
 * Витягує перший `it(` або `test(` блок з вмісту тест-файлу.
 * Відстежує глибину `{}` для коректного завершення.
 * @param {string} content вміст тест-файлу
 * @returns {string | null} перший тест-блок або null
 */
export function extractFirstTestBlock(content) {
  const lines = content.split('\n')
  let startLine = -1
  let depth = 0
  let inBlock = false
  const result = []
  for (const [i, line] of lines.entries()) {
    if (startLine === -1 && TEST_BLOCK_START.test(line)) startLine = i
    if (startLine === -1) continue
    result.push(line)
    for (const ch of line) {
      if (ch === '{') {
        depth++
        inBlock = true
      } else if (ch === '}') depth--
    }
    if (inBlock && depth === 0) break
  }
  return result.length > 0 ? result.join('\n') : null
}

/**
 * Шукає тест-файл для заданого source-файлу і повертає перший тест-блок як приклад стилю.
 * Кандидати: `<base>.test.js`, `<base>.test.mjs`, `<dir>/tests/<name>.test.js`.
 * @param {string} jsRoot абсолютний шлях до JS-кореня
 * @param {string} filename відносний шлях source-файлу (від jsRoot)
 * @returns {{testFile:string, code:string|null} | null} null — якщо тест-файл не знайдено
 */
export function findExampleTest(jsRoot, filename) {
  const base = filename.replace(FILE_EXTENSION, '')
  const candidates = [`${base}.test.js`, `${base}.test.mjs`, `${base}.test.ts`]
  const lastSlash = base.lastIndexOf('/')
  if (lastSlash !== -1) {
    const dir = base.slice(0, lastSlash)
    const name = base.slice(lastSlash + 1)
    candidates.push(`${dir}/tests/${name}.test.js`, `${dir}/tests/${name}.test.mjs`)
  }
  for (const rel of candidates) {
    const full = join(jsRoot, rel)
    if (!existsSync(full)) continue
    const content = readFileSync(full, 'utf8')
    return { testFile: rel, code: extractFirstTestBlock(content) }
  }
  return null
}

/**
 * Парс Stryker mutation.json: Killed+Timeout → caught; Survived+NoCoverage → до total.
 * Compile/Runtime errors виключаються з total.
 * Survived мутанти групуються по файлах з exampleTest.
 * @param {{files:Record<string,{mutants:Array<{status:string,mutatorName?:string,replacement?:string,location?:{start:{line:number,column:number},end:{line:number,column:number}}}>}>}} report Stryker mutation.json
 * @param {string|null} [jsRoot] корінь для читання source-рядків і пошуку тест-файлів
 * @returns {{caught:number,total:number,survived:Array<{file:string,mutants:Array<{line:number,col:number,mutantType:string,original:string,replacement:string}>,exampleTest:{testFile:string,code:string|null}|null,recommendationText:string|null}>}} результат парсу: caught/total та згруповані survived мутанти
 */
export function parseStrykerReport(report, jsRoot) {
  let caught = 0
  let total = 0
  /** @type {Map<string, Array<{line:number,col:number,mutantType:string,original:string,replacement:string}>>} */
  const byFile = new Map()

  for (const [filePath, fileData] of Object.entries(report.files)) {
    let fileLines = null
    for (const mutant of fileData.mutants) {
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
        caught += 1
        total += 1
      } else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
        total += 1
        if (mutant.status === 'Survived' && jsRoot && mutant.location) {
          if (!fileLines) {
            try {
              fileLines = readFileSync(join(jsRoot, filePath), 'utf8').split('\n')
            } catch {
              fileLines = []
            }
          }
          if (!byFile.has(filePath)) byFile.set(filePath, [])
          byFile.get(filePath).push({
            line: mutant.location.start.line,
            col: mutant.location.start.column,
            mutantType: mutant.mutatorName ?? 'Unknown',
            original: extractOriginal(fileLines, mutant.location),
            replacement: mutant.replacement ?? ''
          })
        }
      }
    }
  }

  const survived = []
  for (const [file, mutants] of byFile) {
    survived.push({
      file,
      mutants,
      exampleTest: jsRoot ? findExampleTest(jsRoot, file) : null,
      recommendationText: null
    })
  }

  return { caught, total, survived }
}

/**
 * Default runner — спавнить реальні bun-команди через `node:child_process.spawnSync`
 * (працює і в Node-runtime через shebang `n-cursor`, і в Bun). Замінюється у тестах.
 */
const defaultRunner = {
  runJsCoverage({ cwd, lcovDir }) {
    const r = spawnSync(
      'bunx',
      ['vitest', 'run', '--coverage', '--coverage.reporter=lcov', `--coverage.reportsDirectory=${lcovDir}`],
      { cwd, stdio: 'inherit', env: process.env }
    )
    return r.status ?? 1
  },
  runStryker({ cwd }) {
    const r = spawnSync('bunx', ['@stryker-mutator/core', 'run'], { cwd, stdio: 'inherit', env: process.env })
    return r.status ?? 1
  }
}

/**
 * Збирає JS-метрики покриття + мутаційного тестування. У monorepo ітерує кожен
 * JS-root з `resolveAllJsRoots()` (включно з glob-патернами на кшталт `cf/*`),
 * запускає vitest+Stryker у кожному та сумує lcov/mutation. Шляхи файлів у
 * `survived` рібейзяться відносно `cwd`, щоб `coverage-fix.mjs` знаходив джерела.
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner}} [opts] runner-ін'єкція для тестів
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>>} рядки для COVERAGE.md
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const jsRoots = await resolveAllJsRoots(cwd)
  if (jsRoots.length === 0) throw new Error('js-lint coverage: package.json не знайдено')

  let coverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  let mutation = { caught: 0, total: 0 }
  const survived = []

  for (const jsRoot of jsRoots) {
    const wsRel = relative(cwd, jsRoot)

    // 1. Coverage через vitest run --coverage (v8 provider пише lcov.info у lcovDir)
    const lcovDir = await mkdtemp(join(tmpdir(), 'js-lint-cov-'))
    try {
      const code = await runner.runJsCoverage({ cwd: jsRoot, lcovDir })
      if (code !== 0) throw new Error(`JS coverage exit ${code}`)
      coverage = addCoverage(coverage, parseLcov(await readFile(join(lcovDir, 'lcov.info'), 'utf8')))
    } finally {
      await rm(lcovDir, { recursive: true, force: true })
    }

    // 2. Mutation через Stryker
    await runner.runStryker({ cwd: jsRoot })
    let mutationReport
    try {
      mutationReport = JSON.parse(await readFile(join(jsRoot, 'reports', 'stryker', 'mutation.json'), 'utf8'))
    } catch {
      throw new Error(
        'js-lint coverage: stryker не залишив mutation.json — ' +
          'запусти `npx @nitra/cursor fix test` для встановлення canonical stryker.config.mjs, ' +
          'або налаштуй його вручну'
      )
    }
    const parsed = parseStrykerReport(mutationReport, jsRoot)
    mutation = addMutation(mutation, { caught: parsed.caught, total: parsed.total })

    for (const group of parsed.survived) {
      survived.push({
        ...group,
        file: wsRel === '' ? group.file : join(wsRel, group.file),
        exampleTest: group.exampleTest
          ? {
              ...group.exampleTest,
              testFile: wsRel === '' ? group.exampleTest.testFile : join(wsRel, group.exampleTest.testFile)
            }
          : null
      })
    }
  }

  return [{ area: 'JS', coverage, mutation, survived }]
}

/**
 * Сумування coverage-totals — імпортується з оркестратора при потребі; тут
 * локальна копія, щоб уникнути циклу test/coverage → js-lint/coverage.
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} a перший
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} b другий
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} сума
 */
function addCoverage(a, b) {
  return {
    lines: { covered: a.lines.covered + b.lines.covered, total: a.lines.total + b.lines.total },
    functions: {
      covered: a.functions.covered + b.functions.covered,
      total: a.functions.total + b.functions.total
    }
  }
}

/**
 * Сумування mutation-counts.
 * @param {{caught:number,total:number}} a перший
 * @param {{caught:number,total:number}} b другий
 * @returns {{caught:number,total:number}} сума
 */
function addMutation(a, b) {
  return { caught: a.caught + b.caught, total: a.total + b.total }
}
