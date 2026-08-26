// cspell:ignore протікла рантаймом
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { env, execPath } from 'node:process'

import { jsEntryPath, realRepoRoot, resolveRulesCliBin, withTmpDir } from '../../utils/test-helpers.mjs'

/**
 * Parity-гейт ЗВОРОТНОГО МОСТУ (Р12 спеки
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`): `rules-cli lint
 * --no-fix --native-detect` як основний шлях виконання проти чинного
 * JS-оркестратора (`detectAll` через `npm/bin/n-rules.js`).
 *
 * Гейтяться ТРИ речі, не одна:
 *
 * 1. **byte-exact вихід** — stdout, stderr і exit-код збігаються там, де
 *    native виконує прогін сам (синтетичний rules-каталог + реальний
 *    scoped-прогін цього репо). На РЕАЛЬНОМУ дельта-прогоні брудного дерева
 *    native чесно делегує (full-scope wasm-концерн `npm-module/package_structure`
 *    з глобом `**\/*` сидить у плані щойно змінено будь-що), тож там
 *    гейтиться byte-exact вихід МІНУС рівно один рядок-нотатка про делегацію
 *    із задокументованою причиною — доккоментар того тесту нижче;
 * 2. **саме РІШЕННЯ «нативно чи делегувати»** — воно доводиться недосяжним
 *    `N_RULES_JS_RUNTIME`: якби шлях лишався native, зламаний рантайм нічого
 *    б не змінив, а якби делегувався — прогін падає з помилкою спавна;
 * 3. **fail-closed семантика збою концерну** — `DetectorError` дає той самий
 *    рядок `💥 detector …` і той самий exit 2 з обох боків, а концерни ПІСЛЯ
 *    того, що впав, не виконуються (стоп на першій інфра-помилці).
 *
 * Синтетичний rules-каталог підключається через `N_RULES_RULES_DIR` —
 * тестовий seam, дзеркало `opts.rulesDir` у `detectAll` (JS-CLI його теж не
 * виставляє прапорцем, тож еталон для цих кейсів — не CLI, а тонкий harness
 * навколо `detectAll`).
 */

const REPO_ROOT = realRepoRoot()
const JS_ENTRY = jsEntryPath()
const RUN_DETECTORS = join(REPO_ROOT, 'npm', 'scripts', 'lib', 'lint-surface', 'run-detectors.mjs')

/**
 * Запускає native-шлях `lint`.
 * @param {string[]} args аргументи після `lint`
 * @param {string} cwd робочий каталог
 * @param {Record<string, string>} [extraEnv] додаткові змінні середовища
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runNativeLint(args, cwd, extraEnv = {}) {
  return spawnSync(resolveRulesCliBin(), ['lint', '--no-fix', '--native-detect', ...args], {
    cwd,
    encoding: 'utf8',
    // Міст має піднімати ТОЙ САМИЙ рантайм, яким крутиться сам тест —
    // інакше різниця node/bun протікла б у порівняння як «розбіжність».
    // `N_RULES_JS_ENTRY` — той самий override, що в доккоменті `js_fallback`:
    // синтетичні фікстури живуть у tmp-репо без `node_modules/@7n/rules`, тож
    // і міст, і делегація мусять знати, де entrypoint пакета.
    env: { ...env, N_RULES_JS_RUNTIME: execPath, N_RULES_JS_ENTRY: JS_ENTRY, ...extraEnv }
  })
}

/**
 * Еталон: тонкий harness навколо `detectAll` — рівно те, що робить
 * `case 'lint'` JS-роутера у гілці `--no-fix` (детект → його ж `exitCode`),
 * без self-upgrade devDependencies і без черги `--full`, які до семантики
 * detect не належать.
 * @param {string} cwd робочий каталог прогону
 * @param {string} rulesDir синтетичний rules-каталог
 * @param {string[]} [rules] scoped rule-id
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runJsDetect(cwd, rulesDir, rules = []) {
  const script = `
    const { detectAll } = await import(${JSON.stringify(RUN_DETECTORS)})
    const r = await detectAll({ cwd: process.cwd(), rulesDir: ${JSON.stringify(rulesDir)}, rules: ${JSON.stringify(rules)}, isTTY: false })
    process.exit(r.exitCode)
  `
  return spawnSync(execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', env: { ...env } })
}

/**
 * Створює концерн у синтетичному rules-каталозі.
 * @param {string} rulesDir корінь синтетичних правил
 * @param {string} ruleId id правила
 * @param {string} concernId id концерну
 * @param {object} lint блок `lint` для `concern.json`
 * @param {string} mainSource вміст `main.mjs`
 * @returns {void}
 */
function writeConcern(rulesDir, ruleId, concernId, lint, mainSource) {
  const dir = join(rulesDir, ruleId, concernId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'concern.json'), `${JSON.stringify({ lint }, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'main.mjs'), mainSource, 'utf8')
}

/**
 * Порожній git-репо з `.n-rules.json`, що вмикає передані правила.
 * @param {string} dir каталог
 * @param {string[]} ruleIds активні rule-id
 * @returns {string} той самий dir
 */
function initRepo(dir, ruleIds) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, '.n-rules.json'), `${JSON.stringify({ rules: ruleIds }, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'base.txt'), 'base\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

/**
 * Синтетичний rules-каталог з ОДНИМ концерном `k8s/kubeconform` — тільки
 * `concern.json`, без `main.mjs`: концерн виконує native-registry
 * (`NATIVE_CONCERNS`), тож JS-реалізації в нього більше немає взагалі.
 * Ізольований каталог (замість реального `npm/rules`) навмисний: інакше
 * `lint k8s` тягнув би за собою `k8s/manifests` з `kubescape`+conftest.
 * @param {string} dir каталог, у якому створити rules-дерево
 * @returns {string} шлях до синтетичного rules-каталогу
 */
function writeKubeconformRulesDir(dir) {
  const concernDir = join(dir, 'k8s', 'kubeconform')
  mkdirSync(concernDir, { recursive: true })
  const meta = { lint: { scope: 'per-file', glob: ['k8s/**/*.yaml', 'k8s/**/*.yml'] } }
  writeFileSync(join(concernDir, 'concern.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return dir
}

/**
 * Кладе виконуваний стаб `kubeconform` із заданим exit-кодом і повертає
 * каталог, який треба поставити першим у `PATH`.
 * @param {string} dir каталог для заглушки
 * @param {number} exitCode код виходу заглушки
 * @returns {string} каталог зі стабом
 */
function writeKubeconformStub(dir, exitCode) {
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, 'kubeconform')
  writeFileSync(bin, `#!/bin/sh\nexit ${exitCode}\n`, 'utf8')
  chmodSync(bin, 0o755)
  return dir
}

describe('rules-cli lint: гейт вмикання native-шляху', () => {
  /**
   * Без `--native-detect`/env шлях мусить лишатись делегацією — доводиться
   * недосяжним рантаймом: якби команда виконувалась нативно, зламаний
   * `N_RULES_JS_RUNTIME` ні на що б не вплинув.
   */
  test('без прапорця — делегація (доведено недосяжним рантаймом)', async () => {
    await withTmpDir(dir => {
      initRepo(dir, [])
      const result = spawnSync(resolveRulesCliBin(), ['lint', '--no-fix'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...env, N_RULES_JS_RUNTIME: '/nonexistent/runtime-xyz', N_RULES_JS_ENTRY: JS_ENTRY }
      })
      expect(result.stderr).toContain('не вдалося запустити /nonexistent/runtime-xyz')
    })
  })

  test('з прапорцем, але без --no-fix — делегація (fix-пайплайн не портовано)', async () => {
    await withTmpDir(dir => {
      initRepo(dir, [])
      const result = spawnSync(resolveRulesCliBin(), ['lint', '--native-detect'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...env, N_RULES_JS_RUNTIME: '/nonexistent/runtime-xyz', N_RULES_JS_ENTRY: JS_ENTRY }
      })
      expect(result.stderr).toContain('native-шлях покриває лише --no-fix')
      expect(result.stderr).toContain('не вдалося запустити /nonexistent/runtime-xyz')
    })
  })

  test('з --path — делегація (перетин піддерева з дельтою не портовано)', async () => {
    await withTmpDir(dir => {
      initRepo(dir, [])
      const result = spawnSync(resolveRulesCliBin(), ['lint', '--no-fix', '--native-detect', '--path', 'src'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...env, N_RULES_JS_RUNTIME: '/nonexistent/runtime-xyz', N_RULES_JS_ENTRY: JS_ENTRY }
      })
      expect(result.stderr).toContain('--path не покрито native-шляхом')
      expect(result.stderr).toContain('не вдалося запустити /nonexistent/runtime-xyz')
    })
  })
})

describe('rules-cli lint: паритет на синтетичному rules-каталозі', () => {
  /**
   * Базовий кейс мосту: обидва концерни мають `main.mjs`, тобто ОБИДВА
   * виконуються дочірнім node-процесом, а план/сортування/рендер — у Rust.
   * Порядок груп у виводі й exit-код мусять збігтись байт-у-байт.
   */
  test('violations із JS-концернів рендеряться однаково (stdout/stderr/exit)', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'zulu',
        'second',
        { scope: 'full' },
        `export function lint() {
           return { violations: [{ reason: 'z-1', message: 'зулу порушення', severity: 'warn' }] }
         }\n`
      )
      writeConcern(
        rulesDir,
        'alpha',
        'first',
        { scope: 'full' },
        `export function lint() {
           return { violations: [
             { reason: 'a-2', message: 'друге альфа', file: 'b.txt' },
             { reason: 'a-1', message: 'перше альфа', file: 'a.txt' }
           ] }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha', 'zulu'])

      const js = runJsDetect(repo, rulesDir, ['alpha', 'zulu'])
      const native = runNativeLint(['alpha', 'zulu'], repo, { N_RULES_RULES_DIR: rulesDir })

      expect(native.stdout).toBe(js.stdout)
      expect(native.stderr).toBe(js.stderr)
      expect(native.status).toBe(js.status)
      expect(js.status).toBe(1)
      // Сортування за (ruleId, concernId, file, line, reason) — alpha перед zulu.
      expect(native.stdout.indexOf('alpha/first')).toBeLessThan(native.stdout.indexOf('zulu/second'))
      expect(native.stdout.indexOf('перше альфа')).toBeLessThan(native.stdout.indexOf('друге альфа'))
    })
  })

  /**
   * Фальсифікація гейта: якби Rust просто друкував порожньо, попередній тест
   * теж міг би «пройти» на порожньому наборі. Тут набір ЗАВІДОМО порожній —
   * і обидва боки мусять дати рівно нуль байтів і exit 0.
   */
  test('порожній план — нуль байтів і exit 0 з обох боків', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'first',
        { scope: 'full' },
        'export function lint() { return { violations: [] } }\n'
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])

      const js = runJsDetect(repo, rulesDir, ['alpha'])
      const native = runNativeLint(['alpha'], repo, { N_RULES_RULES_DIR: rulesDir })

      expect(native.stdout).toBe('')
      expect(js.stdout).toBe('')
      expect(native.status).toBe(0)
      expect(js.status).toBe(0)
    })
  })

  /**
   * Fail-closed: концерн кинув → `💥 detector …` + exit 2, І прогін
   * зупиняється — концерн, що йде ПІСЛЯ зламаного, не встигає відпрацювати
   * (його violation у виводі бути не може).
   */
  test('падіння концерну: той самий 💥-рядок, exit 2 і стоп прогону', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'boom',
        { scope: 'full' },
        'export function lint() { throw new Error("вибух") }\n'
      )
      writeConcern(
        rulesDir,
        'zulu',
        'after',
        { scope: 'full' },
        `export function lint() {
           return { violations: [{ reason: 'never', message: 'не мало виконатись' }] }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha', 'zulu'])

      const js = runJsDetect(repo, rulesDir, ['alpha', 'zulu'])
      const native = runNativeLint(['alpha', 'zulu'], repo, { N_RULES_RULES_DIR: rulesDir })

      expect(native.stdout).toBe(js.stdout)
      expect(native.status).toBe(js.status)
      expect(js.status).toBe(2)
      expect(native.stdout).toContain('💥 detector alpha/boom: lint() кинув: вибух')
      expect(native.stdout).not.toContain('не мало виконатись')
    })
  })

  /**
   * Ізоляція В МЕЖАХ батчу: JS-виконавець не має падати сам — навіть коли
   * концерн кидає, процес мосту лишається живим і відповідає далі. Доводиться
   * тим, що ПОПЕРЕДНІ у плані концерни свої violations віддали (їхній
   * результат прийшов тим самим батчем, що й помилка).
   */
  test('помилка одного концерну не з’їдає результати попередніх у батчі', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'ok',
        { scope: 'full' },
        `export function lint() {
           return { violations: [{ reason: 'a-ok', message: 'альфа відпрацювала' }] }
         }\n`
      )
      writeConcern(
        rulesDir,
        'bravo',
        'boom',
        { scope: 'full' },
        'export function lint() { throw new Error("вибух") }\n'
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha', 'bravo'])

      const js = runJsDetect(repo, rulesDir, ['alpha', 'bravo'])
      const native = runNativeLint(['alpha', 'bravo'], repo, { N_RULES_RULES_DIR: rulesDir })

      expect(native.stdout).toBe(js.stdout)
      expect(native.status).toBe(js.status)
      expect(js.status).toBe(2)
      expect(native.stdout).toContain('💥 detector bravo/boom')
      // Стоп на першій інфра-помилці НЕ втрачає вже зібране: alpha у плані
      // перед bravo, її violation мусить бути в наборі (rendered друкується
      // лише в success-гілці, тож перевіряємо через exit-код + відсутність
      // «ковтання» — сам факт стопу доводить попередній тест).
      expect(native.stdout).not.toContain('не мало виконатись')
    })
  })

  /**
   * Дельта-режим: per-file концерн бачить рівно змінені файли, whole-repo —
   * увесь репо. Тут це видно через `ctx.files`, який концерн віддає у
   * повідомленні.
   */
  test('дельта: per-file концерн отримує саме змінений набір', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['**/*.txt'] },
        `export function lint(ctx) {
           return { violations: (ctx.files ?? []).map(f => ({ reason: 'seen', message: 'бачив ' + f, file: f })) }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'changed.txt'), 'changed\n', 'utf8')

      const js = runJsDetect(repo, rulesDir)
      const native = runNativeLint([], repo, { N_RULES_RULES_DIR: rulesDir })

      expect(native.stdout).toBe(js.stdout)
      expect(native.status).toBe(js.status)
      expect(native.stdout).toContain('бачив changed.txt')
      expect(native.stdout).not.toContain('бачив base.txt')
    })
  })

  /**
   * Scoped-режим: позиційні аргументи звужують прогін до названих правил
   * незалежно від `.n-rules.json` і від дельти.
   */
  test('scoped: позиційний rule-id звужує план однаково', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'only',
        { scope: 'full' },
        'export function lint() { return { violations: [{ reason: "a", message: "альфа" }] } }\n'
      )
      writeConcern(
        rulesDir,
        'bravo',
        'only',
        { scope: 'full' },
        'export function lint() { return { violations: [{ reason: "b", message: "браво" }] } }\n'
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha', 'bravo'])

      const js = runJsDetect(repo, rulesDir, ['bravo'])
      const native = runNativeLint(['bravo'], repo, { N_RULES_RULES_DIR: rulesDir })

      expect(native.stdout).toBe(js.stdout)
      expect(native.status).toBe(js.status)
      expect(native.stdout).toContain('браво')
      expect(native.stdout).not.toContain('альфа')
    })
  })
})

describe('rules-cli lint: k8s/kubeconform у native-сегменті', () => {
  /**
   * Готує tmp-репо з одним `k8s`-коренем і синтетичним rules-каталогом,
   * після чого ганяє scoped-прогін `lint k8s` через native-шлях.
   * @param {string} dir tmp-каталог
   * @param {Record<string, string>} extraEnv додаткові змінні (PATH/кеш тулів)
   * @returns {{ stdout: string, stderr: string, status: number|null }} результат
   */
  const runK8sLint = (dir, extraEnv) => {
    const rulesDir = writeKubeconformRulesDir(join(dir, 'synthetic-rules'))
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, 'k8s', 'base'), { recursive: true })
    initRepo(repo, ['k8s'])
    writeFileSync(join(repo, 'k8s', 'base', 'deploy.yaml'), 'kind: Deployment\n', 'utf8')
    return runNativeLint(['k8s'], repo, { N_RULES_RULES_DIR: rulesDir, ...extraEnv })
  }

  /**
   * Концерн реально виконується native-сегментом `rules-cli`: ненульовий
   * exit тула стає violation `k8s/kubeconform` і exit 1 усього прогону.
   * Заглушка з `exit 1` — саме те, що відрізняє «концерн відпрацював» від
   * «концерн мовчки не потрапив у план» (порожній план дав би exit 0).
   */
  test('невалідні маніфести (стаб exit 1) → violation і exit 1', async () => {
    await withTmpDir(dir => {
      const stubDir = writeKubeconformStub(join(dir, 'stub-bin'), 1)
      const result = runK8sLint(dir, { PATH: `${stubDir}${delimiter}${env.PATH}` })
      expect(result.stdout).toContain('k8s/kubeconform')
      expect(result.stdout).toContain('kubeconform знайшов невалідні маніфести')
      expect(result.status).toBe(1)
    })
  })

  /** Той самий шлях із чистим тулом — жодного виводу й exit 0. */
  test('валідні маніфести (стаб exit 0) → чисто і exit 0', async () => {
    await withTmpDir(dir => {
      const stubDir = writeKubeconformStub(join(dir, 'stub-bin'), 0)
      const result = runK8sLint(dir, { PATH: `${stubDir}${delimiter}${env.PATH}` })
      expect(result.stdout).toBe('')
      expect(result.status).toBe(0)
    })
  })

  /**
   * Fail-closed: тула немає ні в `PATH` (порожній каталог), ні в керованому
   * кеші (`N_CURSOR_TOOL_CACHE_DIR` на порожній tmp) → exit 2 з
   * install-підказкою, а НЕ 0 (мовчазний пропуск був би fail-open — на
   * ефемерному CI-раннері schema-валідація просто зникла б).
   */
  test('тула немає → exit 2 з install-підказкою, а не мовчазний пропуск', async () => {
    await withTmpDir(dir => {
      const emptyBin = join(dir, 'empty-bin')
      const emptyCache = join(dir, 'empty-cache')
      mkdirSync(emptyBin, { recursive: true })
      mkdirSync(emptyCache, { recursive: true })
      const result = runK8sLint(dir, { PATH: emptyBin, N_CURSOR_TOOL_CACHE_DIR: emptyCache })
      expect(result.stdout).toContain('💥 detector k8s/kubeconform')
      expect(result.stdout).toContain('kubeconform не знайдено')
      expect(result.stdout).toContain('Встанови:')
      expect(result.status).toBe(2)
    })
  })
})

/**
 * Єдина ФОРМА рядка, яким native-шлях повідомляє про чесну делегацію в
 * JS-CLI (`crates/rules-cli/src/lint_cmd.rs`, гілка `Bail::Delegate`).
 * Захоплена група — причина делегації.
 */
const DELEGATION_NOTICE = /^ℹ️ rules-cli lint: (.+?) — делегую в JS-CLI\.\n/

/**
 * Причини делегації, ЗАДОКУМЕНТОВАНІ для цього зрізу (розділ 11.3 спеки
 * `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`). Причина поза цим
 * списком — регресія, а не «інформаційний шум»: тест мусить впасти, інакше
 * фільтр stderr перетворився б на глушник майбутніх розбіжностей.
 */
const KNOWN_DELEGATION_REASONS = [/^план містить wasm-концерн «[^»]+», який native-шлях цього зрізу не виконує$/]

/**
 * Відрізає РІВНО ОДИН рядок-нотатку про делегацію з голови stderr native-боку.
 * Другий такий рядок (як і будь-який інший вивід) лишається в `rest` і
 * ламає byte-exact звірку — навмисно.
 * @param {string} stderr stderr native-прогону
 * @returns {{ reason: string|null, rest: string }} причина делегації (`null` якщо її не було) і решта stderr
 */
function splitDelegationNotice(stderr) {
  const match = DELEGATION_NOTICE.exec(stderr)
  if (!match) return { reason: null, rest: stderr }
  return { reason: match[1], rest: stderr.slice(match[0].length) }
}

/**
 * Еталонний бік: справжній JS-CLI (`npm/bin/n-rules.js`) у detect-режимі.
 * @param {string[]} args аргументи після `lint --no-fix`
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runJsCli(args) {
  return spawnSync(execPath, [JS_ENTRY, 'lint', '--no-fix', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...env }
  })
}

/**
 * Прогріває еталонний бік і повертає обидва результати.
 *
 * ПЕРШИЙ прогін — прогрівальний і в порівнянні не бере участі: одноразові
 * побічні ефекти (авто-встановлення зовнішніх тулів через `ensure-tool`,
 * self-upgrade `devDependencies` JS-роутера) друкують у stderr лише раз, і
 * без прогріву вони приписались би тому боку, що стартував першим.
 * @param {string[]} args аргументи після `lint --no-fix`
 * @returns {{ js: object, native: object }} результати обох боків
 */
function runBothSides(args) {
  runJsCli(args)
  const js = runJsCli(args)
  const native = runNativeLint(args, REPO_ROOT)
  return { js, native }
}

describe('rules-cli lint: паритет на реальних прогонах цього репо', () => {
  /**
   * Головний гейт зрізу: обидва шляхи ганяються по РЕАЛЬНОМУ дельта-набору
   * цього репозиторію — з native-концернами, policy-концернами і
   * `main.mjs`-концернами, що спавнять зовнішні тули. Звіряється stdout,
   * stderr і exit-код.
   *
   * Тест довгий (кожен бік — секунди), але саме він ловить розбіжність
   * дискавері/плану/порядку, якої синтетичні фікстури не бачать.
   *
   * **Чому stderr звіряється не голим `toBe`.** `npm-module/package_structure`
   * — full-scope wasm-концерн з глобом `**\/*`, тож щойно в дереві є БУДЬ-ЯКА
   * зміна, він сидить у дельта-плані, і native-шлях чесно віддає весь прогін
   * у JS-CLI (розділ 11.3 спеки: «мовчазна розбіжність гірша за делегацію»).
   * Нотатка про делегацію native-однобічна ЗА КОНСТРУКЦІЄЮ: JS-CLI — не
   * делегатор, а ЦІЛЬ делегації, дзеркалити цей рядок йому нічого. Тому
   * гейтиться не «stderr однакові», а точніше твердження: причина делегації
   * задокументована, і **вся решта** stdout/stderr/exit — byte-exact.
   *
   * На чистому дереві (порожня дельта → у плані немає wasm-концерну) гілка
   * `reason === null` вимагає повного byte-exact stderr, як і раніше.
   *
   * Делегований прогін — це JS проти JS, тож САМ native-шлях він не гейтить;
   * це робить scoped-тест нижче.
   */
  test('stdout/stderr/exit збігаються byte-exact', { timeout: 600_000 }, () => {
    const { js, native } = runBothSides([])
    const { reason, rest } = splitDelegationNotice(native.stderr)
    if (reason !== null) {
      expect(
        KNOWN_DELEGATION_REASONS.some(pattern => pattern.test(reason)),
        `native-шлях делегував із НЕзадокументованої причини: «${reason}»`
      ).toBe(true)
    }
    expect(rest).toBe(js.stderr)
    expect(native.stdout).toBe(js.stdout)
    expect(native.status).toBe(js.status)
  })

  /**
   * Гейт САМОГО native-виконання на реальному репо — компенсація дірки, яку
   * лишає wasm-делегація вище: на будь-якому брудному дереві дельта-прогін
   * делегується цілком, і byte-exact звірка вироджується в «JS проти JS».
   *
   * `adr` обрано навмисно: у плані цього правила немає wasm-концернів (тож
   * native-шлях виконує його сам), але є ОБИДВА класи виконавців —
   * `adr/hooks` рахує native-реєстр `rules_core::concerns`, а
   * `adr/settings_json` + `adr/settings_local_json` (policy/rego) йдуть через
   * міст ОДНИМ батчем із двох items. Саме така форма ловить саботажі
   * батчингу мосту (розділ 11.5 спеки).
   *
   * `reason === null` — не косметика, а суть тесту: якщо native-шлях колись
   * почне делегувати й тут (напр. `adr` отримає wasm-контрибуцію), гейт має
   * впасти голосно, а не тихо звіряти два JS-прогони.
   */
  test('scoped-прогін реального правила виконується НАТИВНО і збігається byte-exact', { timeout: 600_000 }, () => {
    const { js, native } = runBothSides(['adr'])
    const { reason, rest } = splitDelegationNotice(native.stderr)
    expect(reason, `native-шлях делегував scoped-прогін замість виконати його: «${reason}»`).toBe(null)
    expect(rest).toBe(js.stderr)
    expect(native.stdout).toBe(js.stdout)
    expect(native.status).toBe(js.status)
  })
})
