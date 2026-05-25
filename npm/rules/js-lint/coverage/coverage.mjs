/**
 * JS-провайдер для `n-cursor coverage`: збирає метрики покриття (`bun test --coverage`)
 * і мутаційного тестування (Stryker) для JS/TS коду. Активується через `js-lint`
 * правило в `.n-cursor.json#rules`; реальна applies-логіка — у `detect(cwd)`.
 *
 * Контракт провайдера — у docs/superpowers/specs/2026-05-24-coverage-rule-design.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveJsRoot } from '../../../scripts/utils/resolve-js-root.mjs'

/**
 * Чи `scripts` містить coverage-сумісну команду.
 * @param {Record<string, string> | undefined} scripts секція scripts з package.json
 * @returns {boolean} true, якщо є test:coverage або test з --coverage
 */
function hasCoverageScript(scripts) {
  if (!scripts || typeof scripts !== 'object') return false
  if (typeof scripts['test:coverage'] === 'string' && scripts['test:coverage'].length > 0) return true
  if (typeof scripts.test === 'string' && scripts.test.includes('--coverage')) return true
  return false
}

/**
 * Чи провайдер застосовний у поточному cwd.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<boolean>} true, якщо знайдено coverage-сумісний test-скрипт
 */
export async function detect(cwd) {
  const jsRoot = await resolveJsRoot(cwd)
  if (jsRoot === null) return false
  const pkgPath = join(jsRoot, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  return hasCoverageScript(pkg.scripts)
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
 * Парс Stryker mutation.json: Killed+Timeout → caught; Survived+NoCoverage → до total.
 * Compile/Runtime errors виключаються з total.
 * @param {{files:Record<string,{mutants:Array<{status:string}>}>}} report розпарсений mutation.json
 * @returns {{caught:number,total:number}} агрегований mutation score
 */
function parseStrykerReport(report) {
  let caught = 0
  let total = 0
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
        caught += 1
        total += 1
      } else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
        total += 1
      }
    }
  }
  return { caught, total }
}

/**
 * Default runner — спавнить реальні bun-команди через `node:child_process.spawnSync`
 * (працює і в Node-runtime через shebang `n-cursor`, і в Bun). Замінюється у тестах.
 */
const defaultRunner = {
  runJsCoverage({ cwd, lcovDir }) {
    const r = spawnSync('bun', ['run', 'test:coverage', '--coverage-reporter=lcov', `--coverage-dir=${lcovDir}`], {
      cwd,
      stdio: 'inherit',
      env: process.env
    })
    return r.status ?? 1
  },
  runStryker({ cwd }) {
    const r = spawnSync('bunx', ['stryker', 'run'], { cwd, stdio: 'inherit', env: process.env })
    return r.status ?? 1
  }
}

/**
 * Збирає JS-метрики покриття + мутаційного тестування.
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner}} [opts] runner-ін'єкція для тестів
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>>} рядки для COVERAGE.md
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const jsRoot = await resolveJsRoot(cwd)
  if (jsRoot === null) throw new Error('js-lint coverage: package.json не знайдено')

  // 1. Coverage через bun test --coverage
  const lcovDir = await mkdtemp(join(tmpdir(), 'js-lint-cov-'))
  let coverage
  try {
    const code = await runner.runJsCoverage({ cwd: jsRoot, lcovDir })
    if (code !== 0) throw new Error(`JS coverage exit ${code}`)
    coverage = parseLcov(await readFile(join(lcovDir, 'lcov.info'), 'utf8'))
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
  const mutation = parseStrykerReport(mutationReport)

  return [{ area: 'JS', coverage, mutation }]
}
