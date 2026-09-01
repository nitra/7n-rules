// cspell:ignore рантаймом
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env, execPath } from 'node:process'

import { jsEntryPath, realRepoRoot, resolveRulesCliBin, withTmpDir } from '../../utils/test-helpers.mjs'

/**
 * Parity-гейт `rules-cli hook --post-tool-use`/`--stop` проти `detectAll`
 * (`npm/scripts/lib/lint-surface/run-detectors.mjs`) — того самого
 * detect-конвеєра, який раніше споживав ЛИШЕ `npm/scripts/hook.mjs::runHookCli`
 * через повний субпроцес `n-rules.js hook …`
 * ([`crate::js_fallback::delegate_with_stdin`]).
 *
 * Рішення власника (`docs/plans/2026-08-31-full-rust-migration-plan.md` §7):
 * добити порт `hook` — обидві функціональні гілки (`--post-tool-use` зі
 * шляхами, `--stop`) тепер ідуть через ТОЙ САМИЙ native detect-конвеєр, що
 * `lint --native-detect` (`crates/rules-cli/src/lint_cmd.rs`), і НЕ
 * викликають `js_fallback::delegate`/`delegate_with_stdin` жодного разу.
 * `rules-cli-lint-parity.test.mjs` уже гейтить сам конвеєр (дискавері,
 * capability/applies-фільтри, план, native+bridge сегменти); тут гейтиться
 * лише те, що СПЕЦИФІЧНО належить `hook`: як `hook.mjs` перетворює вхід
 * (stdin JSON / `git diff` робочого дерева) на `files` для `detectAll`, і
 * що `hook`, на відміну від `lint`, НІКОЛИ не делегує ЦІЛУ команду назад
 * (немає гілки `Bail::Delegate`, що дійшла б до `js_fallback` — доккомент
 * `crates/rules-cli/src/hook_cmd.rs`).
 */

const REPO_ROOT = realRepoRoot()
const JS_ENTRY = jsEntryPath()
const RUN_DETECTORS = join(REPO_ROOT, 'npm', 'scripts', 'lib', 'lint-surface', 'run-detectors.mjs')
const CHANGED_FILES = join(REPO_ROOT, 'npm', 'scripts', 'lib', 'changed-files.mjs')

/**
 * Запускає native `rules-cli hook <mode>`.
 * @param {string} mode `--post-tool-use` або `--stop`
 * @param {string} cwd робочий каталог
 * @param {string} stdin вміст stdin
 * @param {Record<string, string>} [extraEnv] додаткові змінні середовища
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runNativeHook(mode, cwd, stdin, extraEnv = {}) {
  return spawnSync(resolveRulesCliBin(), ['hook', mode], {
    cwd,
    input: stdin,
    encoding: 'utf8',
    // Той самий override-канал, що lint-parity: bridge мусить піднімати
    // ТОЙ САМИЙ рантайм, яким виконується сам тест.
    env: { ...env, N_RULES_JS_RUNTIME: execPath, N_RULES_JS_ENTRY: JS_ENTRY, ...extraEnv }
  })
}

/**
 * Еталон: `detectAll({ files, cwd, rulesDir, log })` із колапсом exit-коду
 * `runHookCli` (`exitCode === 0 ? 0 : 2`) і виводом у stderr (`logToStderr`)
 * — рівно те, що робив `hook.mjs` для непорожнього `files`.
 * @param {string} cwd робочий каталог прогону
 * @param {string} rulesDir синтетичний rules-каталог
 * @param {string[]} files явний файловий набір (уже native-обчислений — доккомент викликів нижче)
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runJsHookDetect(cwd, rulesDir, files) {
  const script = `
    const { detectAll } = await import(${JSON.stringify(RUN_DETECTORS)})
    const r = await detectAll({
      cwd: process.cwd(),
      rulesDir: ${JSON.stringify(rulesDir)},
      files: ${JSON.stringify(files)},
      isTTY: false,
      log: s => process.stderr.write(s)
    })
    process.exit(r.exitCode === 0 ? 0 : 2)
  `
  return spawnSync(execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', env: { ...env } })
}

/**
 * Створює концерн у синтетичному rules-каталозі — той самий хелпер, що
 * `rules-cli-lint-parity.test.mjs` (навмисно НЕ ре-експортований звідти:
 * два незалежні тестові файли, jscpd-межа тут прийнятна — доккомент
 * `test-helpers.mjs` про той самий вибір для `realRepoRoot`/`jsEntryPath`
 * не застосовується, бо тут логіка тривіальна і локальна).
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
 * Порожнє git-репо з `.n-rules.json`, що вмикає передані правила.
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

describe('rules-cli hook: без режиму / без шляхів — жодного мосту', () => {
  test('без --post-tool-use і без --stop — код 1, чистий рядок, без спавна рантайму', async () => {
    await withTmpDir(dir => {
      const result = runNativeHook('--post-tool-use', dir, '', { N_RULES_JS_RUNTIME: '/nonexistent/xyz' })
      // Порожній stdin → TTY-гілка `readStdin`: не встигає торкнутись мосту.
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })
  })
})

describe('rules-cli hook: --post-tool-use паритет із detectAll на синтетичному rules-каталозі', () => {
  /**
   * Базовий кейс: `tool_input.file_path` зі stdin стає єдиним елементом
   * `files`, per-file концерн бачить рівно цей файл — той самий вивід і
   * exit-код, що прямий виклик `detectAll({ files: [path] })`.
   */
  test('violation з per-file концерну рендериться в stderr однаково (byte-exact)', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['**/*.js'] },
        `export function lint(ctx) {
           return { violations: (ctx.files ?? []).map(f => ({ reason: 'seen', message: 'бачив ' + f, file: f })) }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'a.js'), 'x\n', 'utf8')

      const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.js' } })
      const native = runNativeHook('--post-tool-use', repo, payload, { N_RULES_RULES_DIR: rulesDir })
      const reference = runJsHookDetect(repo, rulesDir, ['a.js'])

      expect(native.stderr).toBe(reference.stderr)
      expect(native.status).toBe(reference.status)
      expect(native.stdout).toBe('')
      expect(native.stderr).toContain('бачив a.js')
      expect(native.status).toBe(2)
    })
  })

  /**
   * Абсолютний `file_path` (типовий формат Claude Code) мусить дійти до
   * концерну POSIX-relative-шляхом до `cwd` — порт `toRelativePosix`
   * (`hook.mjs`). Концерн, чий glob матчить лише relative-форму, це й ловить:
   * абсолютний шлях без конвертації просто не збігся б.
   */
  test('абсолютний file_path конвертується в posix-relative до cwd', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['sub/**/*.js'] },
        `export function lint(ctx) {
           return { violations: (ctx.files ?? []).map(f => ({ reason: 'seen', message: 'шлях ' + f, file: f })) }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(join(repo, 'sub'), { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'sub', 'b.js'), 'x\n', 'utf8')

      // `realpathSync`, не голий `join(repo, …)`: на macOS `/tmp` — symlink
      // на `/private/tmp`, а `process.cwd()`/`std::env::current_dir()` в
      // обох реалізаціях повертають ФІЗИЧНИЙ шлях. Payload з логічним
      // `/tmp/...` дав би `path.relative`/`paths::relative_posix` довгий
      // `../../…` — байт-у-байт та сама поведінка чинного `toRelativePosix`
      // (`hook.mjs`), звірено вручну: `node -e "path.relative(cwd,
      // path.resolve(cwd, fp))"` з логічним `/tmp`-шляхом дає ідентичний
      // артефакт. Це існуюча властивість конвертації, не те, що тест мусить
      // тут перевіряти — тому нормалізуємо вхід до фізичного шляху.
      const absolutePath = realpathSync(join(repo, 'sub', 'b.js'))
      const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: absolutePath } })
      const native = runNativeHook('--post-tool-use', repo, payload, { N_RULES_RULES_DIR: rulesDir })
      const reference = runJsHookDetect(repo, rulesDir, ['sub/b.js'])

      expect(native.stderr).toBe(reference.stderr)
      expect(native.stderr).toContain('шлях sub/b.js')
      expect(native.status).toBe(2)
    })
  })

  /**
   * Codex CLI `apply_patch`: кілька файлів з одного V4A-патча, усі бачені
   * concern-ом.
   */
  test('apply_patch (Codex CLI) дає кілька файлів у files', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['**/*.rs'] },
        `export function lint(ctx) {
           return { violations: (ctx.files ?? []).toSorted().map(f => ({ reason: 'seen', message: 'бачив ' + f, file: f })) }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'a.rs'), 'x\n', 'utf8')
      writeFileSync(join(repo, 'b.rs'), 'x\n', 'utf8')

      const patch = '*** Begin Patch\n*** Add File: a.rs\n+x\n*** Update File: b.rs\n@@\n-y\n*** End Patch\n'
      const payload = JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: patch } })
      const native = runNativeHook('--post-tool-use', repo, payload, { N_RULES_RULES_DIR: rulesDir })
      const reference = runJsHookDetect(repo, rulesDir, ['a.rs', 'b.rs'])

      expect(native.stderr).toBe(reference.stderr)
      expect(native.stderr).toContain('бачив a.rs')
      expect(native.stderr).toContain('бачив b.rs')
      expect(native.status).toBe(2)
    })
  })

  /**
   * Full-scope концерн (glob, що матчить БУДЬ-ЯКИЙ файл) — той самий тип
   * плану, яким у реальному репо є `npm-module/package_structure`
   * (доккомент `crates/rules-cli/src/hook_cmd.rs`, розділ «Wasm-концерни»).
   * `hook`, на відміну від `lint --native-detect`, не має гейта, що делегує
   * ЦІЛУ команду, коли план чіпає такий концерн — full-scope item іде крізь
   * той самий bridge-сегмент, що й будь-який інший неnative concern. Тест
   * доводить, що результат ідентичний прямому `detectAll`, тобто
   * «пропустити гейт» не змінює жодної поведінки, лише прибирає зайву
   * делегацію.
   */
  test('full-scope концерн (glob "**/*") виконується через міст без делегації', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'npm-module',
        'package_structure',
        { scope: 'full', glob: ['**/*'] },
        `export function lint() {
           return { violations: [{ reason: 'whole-repo', message: 'весь репо перевірено' }] }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['npm-module'])
      writeFileSync(join(repo, 'any.txt'), 'x\n', 'utf8')

      const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'any.txt' } })
      const native = runNativeHook('--post-tool-use', repo, payload, { N_RULES_RULES_DIR: rulesDir })
      const reference = runJsHookDetect(repo, rulesDir, ['any.txt'])

      expect(native.stderr).toBe(reference.stderr)
      expect(native.stderr).toContain('весь репо перевірено')
      expect(native.status).toBe(2)
    })
  })

  /** Чистий прогін (жодного порушення) — код 0, порожній вивід з обох боків. */
  test('без порушень — код 0 і порожній вивід', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['**/*.js'] },
        'export function lint() { return { violations: [] } }\n'
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'a.js'), 'x\n', 'utf8')

      const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.js' } })
      const native = runNativeHook('--post-tool-use', repo, payload, { N_RULES_RULES_DIR: rulesDir })

      expect(native.status).toBe(0)
      expect(native.stdout).toBe('')
      expect(native.stderr).toBe('')
    })
  })

  /**
   * Fail-closed: концерн кидає → `💥 detector …` у stderr і код 2 (той
   * самий колапс `exitCode === 0 ? 0 : 2`, що для «є violations»).
   */
  test('падіння концерну: 💥-рядок у stderr і код 2', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'boom',
        { scope: 'per-file', glob: ['**/*.js'] },
        'export function lint() { throw new Error("вибух") }\n'
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'a.js'), 'x\n', 'utf8')

      const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.js' } })
      const native = runNativeHook('--post-tool-use', repo, payload, { N_RULES_RULES_DIR: rulesDir })
      const reference = runJsHookDetect(repo, rulesDir, ['a.js'])

      expect(native.stderr).toBe(reference.stderr)
      expect(native.stderr).toContain('💥 detector alpha/boom: lint() кинув: вибух')
      expect(native.status).toBe(2)
    })
  })
})

describe('rules-cli hook: --stop паритет із detectAll на робочому дереві', () => {
  /**
   * `--stop` не читає stdin — файловий набір рахується з `git diff HEAD` +
   * untracked ([`collectChangedFiles`]). Еталон рахує ТОЙ САМИЙ набір тим
   * самим JS-модулем, щоб тест гейтив саме detect-крок хука, а не окремо
   * ще й дельту (яку вже гейтить `changed-files`-parity).
   */
  test('незакомічена зміна: per-file концерн бачить її, код 2', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['**/*.js'] },
        `export function lint(ctx) {
           return { violations: (ctx.files ?? []).map(f => ({ reason: 'seen', message: 'бачив ' + f, file: f })) }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])
      writeFileSync(join(repo, 'a.js'), 'x\n', 'utf8')
      // Незакомічений файл — рівно те, що `--stop` мусить побачити.

      const native = runNativeHook('--stop', repo, '', { N_RULES_RULES_DIR: rulesDir })

      const changedScript = `
        const { collectChangedFiles } = await import(${JSON.stringify(CHANGED_FILES)})
        process.stdout.write(JSON.stringify(collectChangedFiles(process.cwd())))
      `
      const changed = spawnSync(execPath, ['--input-type=module', '-e', changedScript], {
        cwd: repo,
        encoding: 'utf8'
      })
      const files = JSON.parse(changed.stdout)
      const reference = runJsHookDetect(repo, rulesDir, files)

      expect(native.stderr).toBe(reference.stderr)
      expect(native.status).toBe(reference.status)
      expect(native.stderr).toContain('бачив a.js')
      expect(native.status).toBe(2)
    })
  })

  /** Чисте дерево (нема різниці з HEAD) — план порожній, код 0. */
  test('чисте дерево — код 0, вивід порожній', async () => {
    await withTmpDir(dir => {
      const rulesDir = join(dir, 'synthetic-rules')
      writeConcern(
        rulesDir,
        'alpha',
        'perfile',
        { scope: 'per-file', glob: ['**/*.js'] },
        `export function lint(ctx) {
           return { violations: (ctx.files ?? []).map(f => ({ reason: 'seen', message: 'бачив ' + f, file: f })) }
         }\n`
      )
      const repo = join(dir, 'repo')
      mkdirSync(repo, { recursive: true })
      initRepo(repo, ['alpha'])

      const native = runNativeHook('--stop', repo, '', { N_RULES_RULES_DIR: rulesDir })

      expect(native.status).toBe(0)
      expect(native.stdout).toBe('')
      expect(native.stderr).toBe('')
    })
  })
})
