/**
 * JS/TS coverage + mutation-testing колектор: збирає метрики покриття
 * (`vitest run --coverage`) і мутаційного тестування (Stryker з vitest-runner + perTest).
 * Історія: жив у `@nitra/cursor` як rule-провайдер, потім (2026-07-10) — вбудований
 * collector `@7n/test coverage`; після влиття `@7n/test` (spec 2026-07-22) — ядро
 * coverage-провайдера плагіна `@7n/rules-lang-js` (концерн `coverage` правила `test`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { resolveAllJsRoots } from './lib/resolve-js-root.mjs'
import { addCoverage, addMutation } from './aggregate.mjs'
import { hasRunnableTests, isBunNativeRoot } from './bun-native.mjs'
import { STORIES_FILE_RE, hasStories, isStorybookRoot } from './storybook.mjs'
import { parseLcovCoveredLines, runStorybookMutation } from './storybook-mutation.mjs'
import { proposeLlmMutants } from './storybook-mutation-llm.mjs'

const TEST_BLOCK_START = /^\s*(it|test)\(/
const FILE_EXTENSION = /\.[^.]+$/
/**
 * JS/TS/Vue-розширення — файли, які мутує Stryker і покриває vitest. `.vue` включено:
 * Stryker core мутує `<script>`/`<script setup>` блок SFC без окремого плагіна (з версії 7+).
 * Мутувати можна лише те, що покрите НЕ-browser-mode тестами (`@vue/test-utils`+happy-dom
 * тощо), НЕ Storybook-сторі (`@storybook/addon-vitest`, browser mode) — детальніше про чому
 * див. коментар над `collectStorybookForRoot` нижче.
 */
const JS_FILE = /\.(c|m)?[jt]sx?$|\.vue$/
/** Тест-файли (`*.test.*` / `*.spec.*`) — НЕ production-код, не йдуть у Stryker `--mutate`. */
const TEST_FILE = /\.(test|spec)\.[^.]+$/
/** `.vue`-компоненти + `*.stories.*` — сигнал для Storybook-змінного scope (line coverage). */
const VUE_OR_STORIES_FILE = /\.vue$|\.stories\.[^.]+$/
const VUE_FILE_RE = /\.vue$/

/**
 * Звужує список змінених файлів (relative до cwd) до тих, що лежать під `jsRoot`,
 * мають JS/TS-розширення, і рібейзить їх відносно `jsRoot`.
 * @param {string[]} changedFiles relative-до-cwd шляхи змінених файлів
 * @param {string} cwd корінь проєкту
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {string[]} JS-файли під jsRoot, шляхи relative до jsRoot
 */
export function scopeToRoot(changedFiles, cwd, jsRoot) {
  const out = []
  for (const f of changedFiles) {
    if (!JS_FILE.test(f)) continue
    const rel = relative(jsRoot, join(cwd, f))
    if (rel.startsWith('..') || isAbsolute(rel)) continue
    out.push(rel)
  }
  return out
}

/**
 * Звужує список змінених файлів до тих, що стосуються Storybook-покриття
 * (`.vue`-компоненти + `*.stories.*`) під `jsRoot`, рібейзить відносно `jsRoot`.
 * Окремий від `scopeToRoot`: `.vue`/`*.stories.*` НЕ йдуть у Stryker `--mutate`
 * (JS-мутація для Vue поза скоупом), тож не змішуємо scope-и.
 * @param {string[]} changedFiles relative-до-cwd шляхи змінених файлів
 * @param {string} cwd корінь проєкту
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {string[]} `.vue`/`.stories.*`-файли під jsRoot, шляхи relative до jsRoot
 */
export function scopeToStorybookRoot(changedFiles, cwd, jsRoot) {
  const out = []
  for (const f of changedFiles) {
    if (!VUE_OR_STORIES_FILE.test(f)) continue
    const rel = relative(jsRoot, join(cwd, f))
    if (rel.startsWith('..') || isAbsolute(rel)) continue
    out.push(rel)
  }
  return out
}

const VITEST_HINT =
  'js coverage: vitest відсутній у package.json — додай `vitest`, `@vitest/coverage-v8` та `@stryker-mutator/vitest-runner` у devDependencies (див. test.mdc)'

/** Canonical config-файл для full-режиму Storybook-мутації через Stryker command runner. */
const STORYBOOK_STRYKER_CONFIG = 'stryker.storybook.config.mjs'
/** Шлях mutation.json того ж прогону (окремий від `reports/stryker/` JS-виміру). */
const STORYBOOK_STRYKER_REPORT = join('reports', 'stryker-storybook', 'mutation.json')
/** vitest hard-fail коли `--project=!storybook` не залишає жодного проєкту (не test-порожньо). */
const NO_PROJECTS_MATCHED_RE = /No projects matched the filter/

/**
 * Чи у пакеті встановлено vitest (через dependencies або devDependencies).
 * @param {{dependencies?: Record<string,string>, devDependencies?: Record<string,string>}} pkg package.json
 * @returns {boolean} true, якщо `vitest` декларовано хоча б в одному dep-section
 */
function hasVitestDep(pkg) {
  return Boolean(pkg.devDependencies?.vitest) || Boolean(pkg.dependencies?.vitest)
}

/**
 * Чи колектор застосовний у поточному cwd. Активується, коли `vitest`
 * декларовано хоча б в одному JS-root АБО у кореневому `package.json`
 * (workspace-проєкт із hoisted node_modules — типовий патерн bun monorepo).
 * Інакше silent skip із hint у stderr (одноразово).
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
 * Compile/Runtime помилки виключаються з total.
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
 * Шлях до локально встановленого Stryker core-bin (поряд із плагінами на кшталт
 * `@stryker-mutator/vitest-runner`). Запуск саме його через `node` — не `npx`/`bunx` —
 * дає Stryker побачити локальні плагіни при plugin-discovery.
 * @returns {string | null} абсолютний шлях `bin/stryker.js` або `null`, якщо не встановлено
 */
let strykerBinCache

/**
 * Резолвить локальний Stryker core bin (мемоізовано).
 * @returns {string | null} абсолютний шлях `bin/stryker.js` або `null`
 */
function resolveLocalStrykerBin() {
  if (strykerBinCache !== undefined) return strykerBinCache
  try {
    // `exports` у core НЕ відкриває `./bin/stryker.js`, тож резолвимо package.json
    // (доступний) і беремо шлях bin звідти. Ключ bin зазвичай `stryker`; як запас —
    // перше значення map'и.
    const require = createRequire(import.meta.url)
    const pkgJsonPath = require.resolve('@stryker-mutator/core/package.json')
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.stryker ?? Object.values(pkg.bin ?? {})[0])
    strykerBinCache = binRel ? join(dirname(pkgJsonPath), binRel) : null
  } catch {
    strykerBinCache = null
  }
  return strykerBinCache
}

/** Канонічні імена Stryker-конфіга JS-виміру консюмера (test.mdc; .mjs — пріоритет). */
const STRYKER_CONFIG_NAMES = ['stryker.config.mjs', 'stryker.config.js']
/** Маркер посилання на ізольований vitest-конфіг Stryker (канон Storybook, Кластер 5). */
const STRYKER_ISOLATED_VITEST_CONFIG_RE = /vitest\.stryker\.config/

/**
 * Fail-fast контракт канону Storybook (Кластер 5) для JS-виміру мутації: на
 * Storybook-root `stryker.config.*` консюмера МАЄ вказувати `vitest.configFile`
 * на ізольований `vitest.stryker.config.*` (генерує правило `storybook` з
 * `@7n/rules-lang-js` — той самий unit-набір БЕЗ browser-mode `projects`).
 * Основний канонічний `vitest.config` містить browser-mode проєкт "storybook",
 * на якому `@stryker-mutator/vitest-runner` крашиться — без цієї перевірки
 * прогін падає значно пізніше і з незрозумілою помилкою (без mutation.json).
 * Відсутній `stryker.config.*` не перевіряємо — Stryker сам упаде, і повідомлення
 * про відсутній mutation.json нижче вже містить підказку про canonical config.
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @param {string} wsRel відносний шлях root-а (для повідомлення)
 * @returns {void}
 * @throws {Error} коли stryker.config.* існує, але не посилається на vitest.stryker.config.*
 */
function assertStorybookStrykerIsolation(jsRoot, wsRel) {
  const configName = STRYKER_CONFIG_NAMES.find(name => existsSync(join(jsRoot, name)))
  if (!configName) return
  const text = readFileSync(join(jsRoot, configName), 'utf8')
  if (STRYKER_ISOLATED_VITEST_CONFIG_RE.test(text)) return
  throw new Error(
    `js coverage: ${wsRel || '.'} — канонічний Storybook-пакет, але ${configName} не вказує ` +
      'vitest.configFile на ізольований vitest.stryker.config.* — Stryker vitest-runner крашиться ' +
      'на browser-mode проєкті "storybook" основного vitest.config (канон Storybook, Кластер 5). ' +
      'Згенеруй ізольований конфіг концерном storybook-vitest-config (npx @7n/rules lint test) і постав ' +
      "vitest: { configFile: 'vitest.stryker.config.mjs' } у " +
      configName
  )
}

export const defaultRunner = {
  runJsCoverage({ cwd, lcovDir, base, excludeStorybookProject, extraArgs }) {
    // base !== undefined ⇔ --changed-режим: vitest сам рахує зачеплені змінами тести
    // через граф імпортів. `--changed <base>` порівнює base↔робоче дерево (committed і
    // uncommitted разом); `--changed` без аргументу — uncommitted vs HEAD.
    const changedArgs = base === undefined ? [] : base === null ? ['--changed'] : ['--changed', base]
    // excludeStorybookProject: коли root — Storybook-workspace, named vitest-проєкт
    // "storybook" (browser mode, Playwright) типово живе у ТОМУ Ж vitest.config.mjs, що
    // й звичайний JS-suite (canonical setup @storybook/addon-vitest — projects: [...]).
    // Без --project=!storybook цей прогін спробував би виконати і browser-mode тести теж —
    // зайве дублювання з collectStorybookForRoot і ризик втягнути Playwright-залежність
    // у звичайний coverage-прогін.
    const projectArgs = excludeStorybookProject ? ['--project=!storybook'] : []
    const args = [
      'vitest',
      'run',
      '--passWithNoTests',
      '--coverage',
      '--coverage.reporter=lcov',
      `--coverage.reportsDirectory=${lcovDir}`,
      ...projectArgs,
      ...changedArgs,
      // extraArgs — делта per-file вимір (per-file.mjs) додає --coverage.include
      // по змінених файлах, щоб файли без тестів зʼявились у lcov з 0%.
      ...(extraArgs ?? [])
    ]

    if (!excludeStorybookProject) {
      const r = spawnSync('bunx', args, { cwd, stdio: 'inherit', env: process.env })
      return r.status ?? 1
    }

    // excludeStorybookProject-гілка захоплює stdout/stderr (не stdio:'inherit'), бо треба
    // програмно розрізнити "--project=!storybook не залишив ЖОДНОГО проєкту" (типовий
    // canonical @storybook/addon-vitest setup БЕЗ окремого unit-test проєкту — Storybook-root
    // з єдиним named-проєктом "storybook") від реальної помилки. vitest у цьому кейсі кидає
    // hard "No projects matched the filter" і завершується exit≠0 ДО будь-якого запуску тестів
    // (`--passWithNoTests` цей кейс не покриває — той стосується тестів усередині вже
    // знайдених проєктів, не відсутності самих проєктів). Підтверджено емпірично на
    // реальному `storybook init` (Storybook 10 + Vue3, 2026-07): весь `test.projects` — лише
    // "storybook", без окремого JS unit-test проєкту.
    const r = spawnSync('bunx', args, { cwd, encoding: 'utf8', env: process.env })
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    process.stdout.write(r.stdout ?? '')
    process.stderr.write(r.stderr ?? '')
    if (r.status !== 0 && NO_PROJECTS_MATCHED_RE.test(out)) return 0
    return r.status ?? 1
  },
  runBunCoverage({ cwd, lcovDir }) {
    // Bun-native workspace (prod-код імпортує `bun`/`bun:*`): vitest такий модуль не
    // резолвить, тож coverage ганяємо нативним `bun test`. Bun ремапить
    // `import ... from 'vitest'` у тест-файлах на `bun:test` — тести лишаються canon.
    // `--parallel` форкає worker-процес на тестовий файл (ізоляція module-registry):
    // без нього всі файли ділять один process, і leftover mock-стан
    // (`mockResolvedValueOnce`, module-level кеш) з одного файлу протікає в наступний,
    // даючи фантомні падіння. lcov з `--coverage-dir` агрегується коректно з усіх worker-ів.
    const r = spawnSync(
      'bun',
      ['test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${lcovDir}`, '--parallel'],
      {
        cwd,
        stdio: 'inherit',
        env: process.env
      }
    )
    return r.status ?? 1
  },
  runStorybookCoverage({ cwd, lcovDir, base }) {
    // Coverage сторі рахує сам Storybook-vitest-addon (browser mode, Playwright Chromium)
    // через named vitest-проєкт "storybook" (канонічний vitest.config для Vue-проєктів,
    // див. npm/docs) — той самий контракт lcov, що й у звичайного vitest run --coverage.
    const changedArgs = base === undefined ? [] : base === null ? ['--changed'] : ['--changed', base]
    const r = spawnSync(
      'bunx',
      [
        'vitest',
        'run',
        '--project=storybook',
        '--passWithNoTests',
        '--coverage',
        '--coverage.reporter=lcov',
        `--coverage.reportsDirectory=${lcovDir}`,
        ...changedArgs
      ],
      { cwd, stdio: 'inherit', env: process.env }
    )
    return r.status ?? 1
  },
  runStorybookMutantTest({ cwd, storyFilter, timeoutMs }) {
    // Один прогін проти мутованого дерева (mutate→run→restore цикл у
    // storybook-mutation.mjs). storyFilter (сторі-файл компонента) звужує suite до
    // релевантних тестів — browser-mode прогін коштує секунди, повний suite на кожен
    // мутант марнотратний. stdio ignore: важливий лише exit code; вивід мутант-прогонів
    // лише шумів би (десятки прогонів поспіль). null (kill за таймаутом) → Timeout.
    const r = spawnSync('bunx', ['vitest', 'run', '--project=storybook', ...(storyFilter ? [storyFilter] : [])], {
      cwd,
      stdio: 'ignore',
      env: process.env,
      timeout: timeoutMs
    })
    if (r.signal) return null // убитий таймаутом
    return r.status ?? 1
  },
  async proposeStorybookLlmMutants({ file, source, coveredLines, cwd }) {
    // Друге джерело мутантів (Mutahunter/ACH-патерн): LLM пропонує bug-like мутанти,
    // судить так само лише реальний прогін. Graceful degradation: будь-яка помилка
    // (нема API-ключа, мережа) → [] з одноразовим попередженням — детерміновані
    // мутанти працюють далі. Opt-out: N_7N_TEST_NO_LLM_MUTANTS=1.
    try {
      return await proposeLlmMutants({ file, source, coveredLines, cwd })
    } catch (error) {
      if (!defaultRunner._llmMutantsWarned) {
        console.error(`⚠ LLM-мутанти недоступні (${String(error.message ?? error).slice(0, 120)}) — лише детерміновані`)
        defaultRunner._llmMutantsWarned = true
      }
      return []
    }
  },
  runStryker({ cwd, mutate }) {
    // Plugin-discovery Stryker (`@stryker-mutator/*`) globиться відносно CORE-install-каталогу
    // (`core/dist/src/di/plugin-loader.js` → `../../../../../@stryker-mutator/*`). Тож core
    // МАЄ вантажитись із проєктного `node_modules`, де поряд лежить `@stryker-mutator/vitest-runner`.
    // `npx`/`bunx` тягнуть core у власний кеш (`_npx/<hash>`, `bunx-temp`) БЕЗ плагінів → воркери
    // падають `Cannot find TestRunner plugin "vitest"`. Тому резолвимо локальний core-bin через
    // `import.meta.url` і запускаємо його через `node`. Fallback на `npx`, якщо не встановлено.
    // mutate (непорожній) ⇔ --changed-режим: мутуємо лише змінені production-файли цього root.
    const mutateArgs = mutate && mutate.length > 0 ? ['--mutate', mutate.join(',')] : []
    const strykerBin = resolveLocalStrykerBin()
    const r = strykerBin
      ? spawnSync(strykerBin, ['run', ...mutateArgs], { cwd, stdio: 'inherit', env: process.env })
      : spawnSync('npx', ['@stryker-mutator/core', 'run', ...mutateArgs], { cwd, stdio: 'inherit', env: process.env })
    return r.status ?? 1
  },
  runStorybookStrykerFull({ cwd }) {
    // Full-режим Storybook-мутація через canonical `stryker.storybook.config.mjs`
    // (окремий Stryker-прогін, testRunner:'command' — vitest-runner browser mode не
    // підтримує, див. коментар над collectStorybookForRoot). Спайк 2026-07 підтвердив:
    // command runner + vitest browser mode ПРАЦЮЄ з `define` для
    // __STRYKER_ACTIVE_MUTANT__ у vite-конфізі browser-проєкту — канонічний контракт
    // конфіга задокументовано в npm/docs/stryker-storybook-config.md. Той самий
    // резолвінг local-bin, що й runStryker (plugin-discovery відносно install-каталогу).
    const strykerBin = resolveLocalStrykerBin()
    // `configFile` — позиційний аргумент Stryker CLI (`stryker run [options] [configFile]`),
    // НЕ `--configFile` — емпірично підтверджено (реальний прогін, 2026-07): `--configFile`
    // дає `error: unknown option '--configFile'`.
    const args = ['run', STORYBOOK_STRYKER_CONFIG]
    const r = strykerBin
      ? spawnSync(strykerBin, args, { cwd, stdio: 'inherit', env: process.env })
      : spawnSync('npx', ['@stryker-mutator/core', ...args], { cwd, stdio: 'inherit', env: process.env })
    return r.status ?? 1
  }
}

/**
 * Збирає метрики покриття + мутаційного тестування для **одного** JS-root.
 *
 * Full-режим (`scope === null`): vitest на всьому suite + Stryker на всіх файлах
 * config-глоба. Пропускає workspace без тестів (повертає `null`): vitest пройшов з
 * `--passWithNoTests`, але lcov порожній — нема сенсу запускати Stryker.
 *
 * Changed-режим (`scope = { files, base }`): vitest `--changed <base>` (лише
 * зачеплені тести) + Stryker `--mutate` лише по змінених production-файлах. Тут
 * **не** пропускаємо на порожньому lcov — змінений src без тестів має дати
 * NoCoverage-мутанти (gate впаде, як і має). Якщо змінено лише тест-файли (нема
 * production-src) — Stryker не запускаємо (мутувати нічого), повертаємо лише coverage.
 *
 * Bun-native workspace (prod-код імпортує `bun`/`bun:*`): coverage через
 * `bun test --coverage` (vitest не резолвить модуль `bun`), mutation пропускається
 * з попередженням — Stryker vitest-runner такий код не виконає.
 *
 * `.vue`-мутація: Stryker core мутує `<script>`/`<script setup>` SFC без окремого плагіна.
 * Storybook root (`isStorybookRoot`) → `runJsCoverage` отримує `excludeStorybookProject:
 * true` (`--project=!storybook`), щоб не зачепити browser-mode проєкт (докладніше про стан
 * підтримки browser mode у Stryker — коментар над `collectStorybookForRoot` нижче) —
 * інакше цей самий JS-прогін спробував би й browser-mode тести теж, якщо вони живуть
 * у тому ж vitest.config.mjs.
 *
 * Реальні помилки (vitest/bun exit ≠ 0, відсутній mutation.json попри запуск Stryker)
 * кидаються — у multi-root режимі це не маскує справжній збій.
 * @param {string} jsRoot абсолютний шлях до workspace-кореня
 * @param {string} cwd корінь проєкту (для рібейзингу `survived[].file`)
 * @param {{runJsCoverage:Function, runStryker:Function, runBunCoverage:Function}} runner spawn-ін'єкція
 * @param {{files:string[], base:string|null}|null} [scope] changed-scope (null = full-режим)
 * @returns {Promise<{coverage:object, mutation:{caught:number,total:number}, survived:Array<object>} | null>} результати або null коли full-режим і workspace без тестів
 */
async function collectOneRoot(jsRoot, cwd, runner, scope = null) {
  const wsRel = relative(cwd, jsRoot)

  // Bun-native workspace: coverage через `bun test`, mutation пропускається
  // (Stryker vitest-runner не виконає код з `import ... from 'bun'`).
  const bunNative = await isBunNativeRoot(jsRoot)
  // Storybook root: named vitest-проєкт "storybook" (browser mode) типово ділить один
  // vitest.config.mjs зі звичайним suite — виключаємо його з JS-прогону (див. runJsCoverage).
  const isStorybook = !bunNative && (await isStorybookRoot(jsRoot))
  const excludeStorybookProject = isStorybook

  // У changed-режимі production-файли для мутації = змінені JS/Vue цього root без
  // тест-файлів і без *.stories.* (сторі — не production-код, окремий Storybook-вимір).
  // `.vue` на Storybook-root ТЕЖ виключено: якщо root — Storybook-only (типовий
  // `storybook init`-скаффолд, ЄДИНИЙ vitest-проєкт — "storybook"), Stryker vitest-runner
  // структурно не може прогнати dry-run (немає non-browser проєкту для виконання) —
  // емпірично підтверджено (2026-07, реальний Storybook 10 + Vue3 скаффолд): dry-run
  // валиться, `collectOneRoot` кидає, і це ламає ВЕСЬ прогін (обидва виміри), не лише
  // JS-рядок. `.vue`-мутація на Storybook-root — виключно відповідальність
  // `collectStorybookForRoot` (own executor / command-runner), яка вже покриває SFC
  // повністю; дублювання через JS-вимір там і зайве, і структурно ламке.
  const mutateSrc = scope
    ? scope.files.filter(f => !TEST_FILE.test(f) && !STORIES_FILE_RE.test(f) && !(isStorybook && VUE_FILE_RE.test(f)))
    : null
  if (bunNative && !(await hasRunnableTests(jsRoot))) {
    // `bun test` без тестів завершується помилкою — graceful skip як vitest --passWithNoTests.
    return scope
      ? {
          coverage: { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } },
          mutation: { caught: 0, total: 0 },
          survived: []
        }
      : null
  }

  // 1. Coverage: vitest run --passWithNoTests --coverage (+ --changed) або `bun test --coverage`
  const lcovDir = await mkdtemp(join(tmpdir(), 'js-cov-'))
  let coverage
  try {
    const code = bunNative
      ? await runner.runBunCoverage({ cwd: jsRoot, lcovDir })
      : await runner.runJsCoverage(
          scope
            ? { cwd: jsRoot, lcovDir, base: scope.base, excludeStorybookProject }
            : { cwd: jsRoot, lcovDir, excludeStorybookProject }
        )
    if (code !== 0) throw new Error(`JS coverage exit ${code}`)
    const lcovPath = join(lcovDir, 'lcov.info')
    coverage = existsSync(lcovPath)
      ? parseLcov(await readFile(lcovPath, 'utf8'))
      : { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  } finally {
    await rm(lcovDir, { recursive: true, force: true })
  }

  // Bun-native: mutation testing пропускаємо чесно, з попередженням — Stryker
  // vitest-runner структурно несумісний із bun-native кодом.
  if (bunNative) {
    console.error(
      `⚠ ${wsRel || '.'}: bun-native workspace (import 'bun' у prod-коді) — ` +
        'mutation testing пропущено (Stryker vitest-runner несумісний), лише line coverage'
    )
    return { coverage, mutation: { caught: 0, total: 0 }, survived: [] }
  }

  // Full-режим: порожній lcov ⇔ vitest не знайшов тестів → пропускаємо workspace,
  // щоб не ганяти Stryker марно. У changed-режимі НЕ пропускаємо (див. JSDoc).
  if (!scope) {
    const hasTests = coverage.lines.total > 0 || coverage.functions.total > 0
    if (!hasTests) return null
  }

  // Changed-режим без production-src (змінено лише тест-файли) → мутувати нічого.
  if (scope && mutateSrc.length === 0) {
    return { coverage, mutation: { caught: 0, total: 0 }, survived: [] }
  }

  // 2. Mutation через Stryker (у changed-режимі — лише по mutateSrc). На Storybook-root
  // спершу fail-fast контракт канону: stryker.config.* → ізольований vitest.stryker.config.*.
  if (isStorybook) assertStorybookStrykerIsolation(jsRoot, wsRel)
  await runner.runStryker(scope ? { cwd: jsRoot, mutate: mutateSrc } : { cwd: jsRoot })
  const mutationPath = join(jsRoot, 'reports', 'stryker', 'mutation.json')
  if (!existsSync(mutationPath)) {
    // Stryker vitest-runner не підтримує сучасний (Playwright-based) vitest browser mode
    // (докладніше — коментар над collectStorybookForRoot): якщо стрикер-фейсінг vitest-конфіг
    // (на який вказує stryker.config.mjs#vitest.configFile) містить named-проєкт "storybook",
    // Stryker намагається виконати і його — і падає без mutation.json. Канонічне виправлення
    // (канон Storybook, Кластер 5): ізольований vitest.stryker.config.* (генерує правило
    // storybook) — той самий unit-набір без browser-mode projects.
    const storybookHint = excludeStorybookProject
      ? ' Root — канонічний Storybook-пакет (identity-devDeps у package.json): ' +
        'stryker.config.mjs#vitest.configFile має вказувати на ізольований ' +
        'vitest.stryker.config.mjs (генерує концерн storybook-vitest-config, npx @7n/rules lint test), ' +
        'бо основний vitest.config містить browser-mode проєкт "storybook", ' +
        'який не підтримується vitest-runner.'
      : ''
    throw new Error(
      'js coverage: stryker не залишив mutation.json — ' +
        'переконайся що встановлено canonical stryker.config.mjs (vitest-runner, perTest), ' +
        'або налаштуй його вручну.' +
        storybookHint
    )
  }
  const mutationReport = JSON.parse(await readFile(mutationPath, 'utf8'))
  const parsed = parseStrykerReport(mutationReport, jsRoot)

  return {
    coverage,
    mutation: { caught: parsed.caught, total: parsed.total },
    survived: parsed.survived.map(group => ({
      ...group,
      file: wsRel === '' ? group.file : join(wsRel, group.file),
      exampleTest: group.exampleTest
        ? {
            ...group.exampleTest,
            testFile: wsRel === '' ? group.exampleTest.testFile : join(wsRel, group.exampleTest.testFile)
          }
        : null
    }))
  }
}

/**
 * Збирає Storybook-покриття (Vue-компонентні бібліотеки зі сторі) для **одного** JS-root.
 * Активується лише коли `isStorybookRoot` (канонічні Storybook-identity devDeps у
 * `package.json` — канон Storybook, Кластер 7) і `hasStories` — інакше `null`
 * (root не бере участі у рядку `Vue (Storybook)`).
 *
 * Mutation testing: у **changed-режимі** виконується власним mutate→run→restore
 * executor-ом (`storybook-mutation.mjs`) — детерміновані AST-мутанти по змінених
 * production-файлах, вбиває/милує реальний browser-mode прогін. У **full-режимі**
 * власний executor надто дорогий (усі production-файли, не лише змінені) — тут шлях
 * лише через canonical Stryker command-runner (`STORYBOOK_STRYKER_CONFIG`, див. нижче
 * і `npm/docs/stryker-storybook-config.md`), якщо target-проєкт його налаштував;
 * інакше чесний skip з попередженням (той самий принцип, що й bun-native).
 *
 * **Чому не Stryker (перевіряй перед покладанням на це в майбутньому — площина
 * активно змінюється з обох боків):** issue stryker-js#4557 ("[vitest] support browser
 * mode") ЗАКРИТИЙ через PR stryker-js#4628 ще у 2023 (v8.0.0) — але це стосувалось
 * раннього browser mode доби vitest@1.0.0-beta, ДО сучасної provider-based архітектури
 * (`@vitest/browser-playwright` тощо, стабілізованої у Vitest 4, 2025-12). Той старий фікс
 * НЕ покриває сучасний Playwright-based browser mode, яким користується
 * `@storybook/addon-vitest`: чинна документація Stryker vitest-runner прямо каже
 * "Currently, Browser Mode is not supported" — інструментація Stryker передбачає
 * Node.js-виконання, а сучасний browser mode виконує тести у реальному Chromium через
 * Playwright, що структурно несумісно з тим, як Stryker патчить/спостерігає код.
 * Власний executor слідує патерну, підтвердженому дослідженням спільноти
 * (https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/, Mutahunter,
 * Meta ACH): детермінована генерація мутантів + реальний прогін як суддя — без LLM
 * у контурі виконання.
 *
 * **Full-режим — Stryker command runner (`runStorybookStrykerFull`, опційний у
 * runner-і), ПРАЦЮЄ на реальному проєкті за двох обов'язкових умов (перевіряй
 * перед покладанням — секція «Обмеження» в `npm/docs/stryker-storybook-config.md`):**
 * Spike на синтетичному JS-репо (2026-07-17) підтвердив саму МЕХАНІКУ — command
 * runner + browser mode ПРАЦЮЄ з обов'язковим
 * `define: { 'process.env.__STRYKER_ACTIVE_MUTANT__': JSON.stringify(process.env.__STRYKER_ACTIVE_MUTANT__ ?? '') }`
 * у vite-конфізі (без define — тихий провал, 0% killed). Живий прогін на
 * РЕАЛЬНОМУ `storybook init`-скаффолді (2026-07-18) виявив ДВІ незалежні
 * причини провалу dry-run (`Failed to fetch dynamically imported module`),
 * обидві тепер виправлені конфігом:
 * (1) Stryker-інструментація ламає `vue-docgen-api`-парсер `@storybook/vue3-vite`
 * — root cause підтверджено (інструментований вміст, витягнутий з sandbox і
 * підставлений напряму, відтворює ту саму помилку БЕЗ участі Stryker) і
 * ВИПРАВЛЕНО через `docgen: false` у `.storybook/main.js#framework.options`;
 * (2) Stryker sandbox symlink-ає `node_modules` у тимчасову `.stryker-tmp/sandbox-*`
 * теку (дефолт), а `@storybook/addon-vitest` резолвить абсолютний шлях свого
 * `setup-file.js` через РЕАЛЬНИЙ (symlink-target) шлях, а не sandbox-корінь —
 * Vite dev server відмовляється віддавати файл поза власним root. Підтверджено
 * прямим експериментом: `vitest run` (БЕЗ Stryker) із `node_modules`, вручну
 * зробленим symlink-ом з іншої директорії, відтворює ту саму помилку 1:1;
 * той самий `node_modules`, СКОПІЙОВАНИЙ (не symlink) — працює без помилок.
 * `resolve.preserveSymlinks` (Vite) і `NODE_OPTIONS=--preserve-symlinks` (Node)
 * НЕ допомагають (шлях резолвиться всередині коду самого addon-vitest, не
 * через Vite-резолвер). ВИПРАВЛЕНО через `inPlace: true` у
 * `stryker.storybook.config.mjs` — Stryker мутує файли без sandbox-копії,
 * symlink просто не задіяний.
 * Висновок: з обома фіксами (`docgen: false` + `inPlace: true`) full-режим
 * дає справжній mutation score на реальному Storybook-проєкті;
 * `--changed`-executor (нижче) лишається окремим шляхом для звичайного
 * PR-прогону по змінених файлах.
 *
 * Changed-режим: запускається тільки якщо серед змінених файлів root-а є хоча б
 * один `.vue`/`*.stories.*` (`scope.files` — вже звужений через `scopeToStorybookRoot`
 * на боці виклику); інакше `null` (root пропускається повністю для цього виміру).
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @param {string} cwd корінь проєкту (для рібейзингу `survived[].file`)
 * @param {{runStorybookCoverage:Function, runStorybookMutantTest?:Function, proposeStorybookLlmMutants?:Function, runStorybookStrykerFull?:Function}} runner spawn-ін'єкція
 * @param {{files:string[], base:string|null}|null} [scope] changed-scope (null = full-режим)
 * @returns {Promise<{coverage:object, mutation:{caught:number,total:number}, survived:Array<object>} | null>} результат або null коли root не Storybook/без сторі/без relevant-змін
 */
async function collectStorybookForRoot(jsRoot, cwd, runner, scope = null) {
  const wsRel = relative(cwd, jsRoot)
  if (!(await isStorybookRoot(jsRoot))) return null
  if (!(await hasStories(jsRoot))) return null

  const lcovDir = await mkdtemp(join(tmpdir(), 'sb-cov-'))
  let coverage
  let coveredLines = new Map()
  let baselineMs = 0
  try {
    const startedAt = Date.now()
    const code = await runner.runStorybookCoverage(
      scope ? { cwd: jsRoot, lcovDir, base: scope.base } : { cwd: jsRoot, lcovDir }
    )
    baselineMs = Date.now() - startedAt
    if (code !== 0) {
      throw new Error(
        `Storybook coverage exit ${code} — перевір встановлений Playwright Chromium ` +
          '(`npx playwright install chromium`) і named vitest-проєкт "storybook" (canonical config)'
      )
    }
    const lcovPath = join(lcovDir, 'lcov.info')
    if (existsSync(lcovPath)) {
      const lcovText = await readFile(lcovPath, 'utf8')
      coverage = parseLcov(lcovText)
      coveredLines = parseLcovCoveredLines(lcovText, jsRoot)
    } else {
      coverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
    }
  } finally {
    await rm(lcovDir, { recursive: true, force: true })
  }

  // Full-режим: власний executor надто дорогий (повний suite × кожен мутант ×
  // Chromium на ВСІХ production-файлах, не лише змінених) — тут шлях лише через
  // canonical Stryker command-runner (STORYBOOK_STRYKER_CONFIG), якщо target-проєкт
  // його налаштував (див. npm/docs/stryker-storybook-config.md). Без canonical
  // конфіга або без runStorybookStrykerFull у runner-і — чесний skip, як і раніше.
  if (!scope) {
    const hasCanonicalConfig = existsSync(join(jsRoot, STORYBOOK_STRYKER_CONFIG))
    if (hasCanonicalConfig && typeof runner.runStorybookStrykerFull === 'function') {
      const code = await runner.runStorybookStrykerFull({ cwd: jsRoot })
      const reportPath = join(jsRoot, STORYBOOK_STRYKER_REPORT)
      if (code !== 0 && !existsSync(reportPath)) {
        throw new Error(
          `Storybook Stryker (command runner) exit ${code} — перевір ${STORYBOOK_STRYKER_CONFIG} ` +
            '(testRunner: "command", commandRunner.command, jsonReporter.fileName, inPlace: true), ' +
            'define __STRYKER_ACTIVE_MUTANT__ у vite-конфізі browser-проєкту ' +
            'і docgen: false у .storybook/main.js#framework.options (див. npm/docs/stryker-storybook-config.md)'
        )
      }
      if (existsSync(reportPath)) {
        const report = JSON.parse(await readFile(reportPath, 'utf8'))
        const parsed = parseStrykerReport(report, jsRoot)
        console.log(
          `✓ ${wsRel || '.'}: Storybook mutation (Stryker command runner) — ${parsed.caught}/${parsed.total} вбито`
        )
        return {
          coverage,
          mutation: { caught: parsed.caught, total: parsed.total },
          survived: parsed.survived.map(group => ({
            ...group,
            file: wsRel === '' ? group.file : join(wsRel, group.file)
          }))
        }
      }
    }
    console.error(
      `⚠ ${wsRel || '.'}: Storybook (Vue) — mutation testing пропущено ` +
        `(${hasCanonicalConfig ? 'runner без runStorybookStrykerFull' : `нема ${STORYBOOK_STRYKER_CONFIG}`}), лише line coverage`
    )
    return { coverage, mutation: { caught: 0, total: 0 }, survived: [] }
  }

  // Changed-режим: guard на runStorybookMutantTest тримає сумісність із
  // інжектованими runner-ами без mutation-підтримки (лише line coverage).
  if (typeof runner.runStorybookMutantTest !== 'function') {
    console.error(
      `⚠ ${wsRel || '.'}: Storybook (Vue) — mutation testing пропущено (runner без runStorybookMutantTest), лише line coverage`
    )
    return { coverage, mutation: { caught: 0, total: 0 }, survived: [] }
  }

  // Changed-режим: мутуємо лише змінені production-файли (без сторі/тестів) із покриттям.
  // proposeStorybookLlmMutants (опційний у runner) — друге, LLM-джерело мутантів поверх
  // детермінованих; інжектовані runner-и без нього отримують лише детерміновані.
  const mutationTargets = scope.files.filter(f => !STORIES_FILE_RE.test(f) && !TEST_FILE.test(f))
  const proposeExtra =
    typeof runner.proposeStorybookLlmMutants === 'function'
      ? (file, source, lines) => runner.proposeStorybookLlmMutants({ file, source, coveredLines: lines, cwd: jsRoot })
      : null
  const { caught, total, survived } = await runStorybookMutation({
    jsRoot,
    files: mutationTargets,
    coveredLines,
    runMutantTest: args => runner.runStorybookMutantTest(args),
    resolveStoryFilter: file => findStoryFilter(jsRoot, file),
    proposeExtraMutants: proposeExtra,
    // Мутант-прогін звужено сторі-фільтром і без coverage — baseline (повний coverage-прогін)
    // з запасом 3× покриває навіть повний suite; мінімум страхує холодний старт Chromium.
    timeoutMs: Math.max(30_000, 3 * baselineMs)
  })
  if (total > 0) {
    console.log(`✓ ${wsRel || '.'}: Storybook mutation — ${caught}/${total} вбито (changed-scope)`)
  }

  return {
    coverage,
    mutation: { caught, total },
    survived: survived.map(group => ({
      ...group,
      file: wsRel === '' ? group.file : join(wsRel, group.file)
    }))
  }
}

const STORY_EXTENSIONS = ['js', 'mjs', 'ts', 'jsx', 'tsx']

/**
 * Шукає сторі-файл компонента поряд із ним (`Card.vue` → `Card.stories.{js,ts,...}`)
 * для звуження мутант-прогону до релевантних тестів.
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @param {string} file відносний шлях компонента
 * @returns {string | null} відносний шлях сторі-файлу або null (прогін без фільтра)
 */
function findStoryFilter(jsRoot, file) {
  const base = file.replace(FILE_EXTENSION, '')
  for (const ext of STORY_EXTENSIONS) {
    const candidate = `${base}.stories.${ext}`
    if (existsSync(join(jsRoot, candidate))) return candidate
  }
  return null
}

/**
 * Будує підсумковий рядок з масиву per-root результатів через сумування coverage/mutation.
 * @param {string} area назва рядка (`JS`, `Vue (Storybook)`)
 * @param {Array<{coverage:object, mutation:{caught:number,total:number}, survived:Array<object>}>} results per-root результати
 * @returns {{area:string, coverage:object, mutation:{caught:number,total:number}, survived:Array<object>}} агрегований рядок
 */
function buildAreaRow(area, results) {
  let coverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  let mutation = { caught: 0, total: 0 }
  const survived = []
  for (const r of results) {
    coverage = addCoverage(coverage, r.coverage)
    mutation = addMutation(mutation, r.mutation)
    survived.push(...r.survived)
  }
  return { area, coverage, mutation, survived }
}

/**
 * Збирає JS-метрики покриття + мутаційного тестування, і окремо — Storybook-покриття
 * (Vue/React/... компоненти зі сторі, `collectStorybookForRoot`). У monorepo ітерує усі
 * JS-roots з `resolveAllJsRoots()` (включно з glob-патернами `cf/*`), для кожного root-а
 * запускає обидва виміри незалежно й сумує lcov/mutation окремо через `buildAreaRow`.
 * Workspaces без тестів (JS) або без Storybook-конфігурації/сторі пропускаються по
 * кожному виміру окремо (root може дати лише JS-рядок, лише Storybook-рядок, обидва
 * або жодного). Якщо і JS, і Storybook відсутні всюди — повертає `[]`.
 * Шляхи у `survived` рібейзяться відносно `cwd`, щоб `coverage-fix.mjs`
 * знаходив джерела через `join(projectRoot, file)`.
 *
 * Changed-режим (`opts.changedFiles` задано): JS-вимір отримує лише змінені JS-файли
 * root-а (`scopeToRoot`), Storybook-вимір — лише змінені `.vue`/`*.stories.*`
 * (`scopeToStorybookRoot`); кожен вимір пропускається незалежно, якщо relevant-змін
 * нема. Якщо змін нема ніде — повертає `[]` без error-логу (оркестратор трактує
 * порожній changed-scope як pass).
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner, changedFiles?: string[], base?: string|null}} [opts] runner-ін'єкція + changed-scope
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}, survived:Array<object>}>>} рядки `JS`/`Vue (Storybook)` — лише ті, де є дані
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const changed = Array.isArray(opts.changedFiles)
  const jsRoots = await resolveAllJsRoots(cwd)
  if (jsRoots.length === 0) throw new Error('js coverage: package.json не знайдено')

  const jsResults = []
  const storybookResults = []
  for (const jsRoot of jsRoots) {
    if (changed) {
      const jsFiles = scopeToRoot(opts.changedFiles, cwd, jsRoot)
      if (jsFiles.length > 0) {
        const scope = { files: jsFiles, base: opts.base ?? null }
        const r = await collectOneRoot(jsRoot, cwd, runner, scope)
        if (r !== null) jsResults.push(r)
      }

      const sbFiles = scopeToStorybookRoot(opts.changedFiles, cwd, jsRoot)
      if (sbFiles.length > 0) {
        const sbScope = { files: sbFiles, base: opts.base ?? null }
        const sb = await collectStorybookForRoot(jsRoot, cwd, runner, sbScope)
        if (sb !== null) storybookResults.push(sb)
      }
      continue
    }

    const r = await collectOneRoot(jsRoot, cwd, runner, null)
    if (r !== null) jsResults.push(r)

    const sb = await collectStorybookForRoot(jsRoot, cwd, runner, null)
    if (sb !== null) storybookResults.push(sb)
  }

  const rows = []
  if (jsResults.length > 0) {
    rows.push(buildAreaRow('JS', jsResults))
  } else if (!changed) {
    console.error(
      'js coverage: жоден workspace не має тестів ' +
        '(`*.test.{js,mjs}` у `tests/` або поряд із джерелом) — ' +
        'додай тести або запусти `npx @7n/rules lint test` для генерації'
    )
  }
  if (storybookResults.length > 0) {
    rows.push(buildAreaRow('Vue (Storybook)', storybookResults))
  }
  return rows
}
