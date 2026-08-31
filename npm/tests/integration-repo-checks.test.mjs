/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { existsSync } from 'node:fs'

import { ensureToolAsync } from '../scripts/lib/ensure-tool.mjs'
import { runConcernDetector } from '../scripts/lib/lint-surface/detect.mjs'
import { loadNative } from '../scripts/lib/native.mjs'
import { resetWasmConcernMapForTests, resolveWasmConcernMap } from '../scripts/lib/lint-surface/wasm-plugins.mjs'
import { realRepoRoot, withShellcheckStubInPath, withTmpDir, writeJson } from '../scripts/utils/test-helpers.mjs'
import { resolveCmd } from '../scripts/utils/resolve-cmd.mjs'

// РЕАЛЬНИЙ shellcheck із PATH, зняте на момент ІМПОРТУ цього модуля — до того,
// як тіло тесту нижче обгорне себе в `withShellcheckStubInPath` (фейковий
// «завжди exit 0» стаб, що підмінює shellcheck у PATH ЛИШЕ для того, щоб
// `checkGa` міг ганяти конкретно СВІЙ старий шлях `git`/`shellcheck` на машинах
// без реального shellcheck). Побічний ефект стаба на `checkGa` тепер, коли
// `toolPaths` резолвиться повним `resolveWasmConcernMap` (продакшн-шлях,
// доккомент нижче): `actionlint` сам шеллаутить у `shellcheck` для SC-перевірок
// `run:`-кроків — підсунутий стабом фейк повертає порожній вивід замість
// JSON-звіту, і `actionlint` репортує це як власне порушення (несправжнє —
// на РЕАЛЬНОМУ shellcheck той самий workflow-набір чистий, перевірено вручну).
// `REAL_SHELLCHECK_PATH` дає `checkGa` змогу лишатись на РЕАЛЬНОМУ бінарнику
// (той самий канал, що продакшн `n-rules lint` на dev-машині з установленим
// shellcheck), не займаючи спільний хелпер `withShellcheckStubInPath` — його
// чіпати тут не варто, ним користуються й інші тести цього файлу.
const REAL_SHELLCHECK_PATH = resolveCmd('shellcheck')

// РЕАЛЬНИЙ `PATH`, теж знятий до стаба (доккомент `REAL_SHELLCHECK_PATH` вище)
// — потрібен ДРУГИЙ раз, окремо від `toolPaths.shellcheck`: `actionlint`
// (`npm:github-actionlint`) сам, ЯК ПІДПРОЦЕС, шукає `shellcheck` у СВОЄМУ
// успадкованому `PATH` для SC-перевірок `run:`-кроків — це НЕ наш `exec-tool`
// диспетчер (`toolPaths` на це не впливає), тож підсунутий стабом фейк-бінар
// (завжди `exit 0`, без JSON-виводу) actionlint читає як зламаний shellcheck
// і сам репортує це як `actionlint`-порушення (перевірено: та сама команда з
// РЕАЛЬНИМ `PATH` — 0 violations). `env.PATH` навколо `runWasmConcern` нижче
// ставиться на `REAL_PATH` і повертається назад одразу після виклику.
const REAL_PATH = env.PATH

// Адаптери під unified lint surface: detector → 0 (чисто) / 1 (є violations).
const mk = (fn, ruleId, concernId) => async cwd => {
  const result = await fn({ cwd, ruleId, concernId })
  return result.violations.length === 0 ? 0 : 1
}
const checkK8s = mk(ctx => runConcernDetector(null, ctx), 'k8s', 'manifests')

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

// `k8s/manifests` — native-концерн без `main.mjs`: диспетчер, не прямий
// імпорт. Детектор шукає rego-політики й сніпети у КОРЕНІ ПАКЕТА, якого в
// тимчасовому дереві немає — звідси явний override, задокументований саме під
// цей випадок (`rules_package.rs`). Опційна змінна (fallback за замовчуванням)
// — `env` з `node:process`, не прямий `process.env` (js-run.mdc): мандатний
// `checkEnv`/`@nitra/check-env` тут зайвий, бо значення завжди має дефолт.
env.N_RULES_PACKAGE_ROOT ??= join(REPO_ROOT, 'npm')

// firebase_hosting, env_dns (F1 фази 5 батчу 2), hc_pairing/ua_node_selector/
// ua_http_route (H1 фази 5 батчу 4, YAML-кластер частина 1), text/formatting
// (I1 фази 5 батчу 4, YAML-кластер частина 2) і docker/lint (цей зріз) —
// native-портовані concern-и: `main.mjs` видалено, лишається лише
// native-реєстр (`crates/rules-core`), тож диспатч тут — через
// `runConcernDetector` (той самий шлях, що й dispatch-рівень
// concern-тестів), а не прямий `lint()`-імпорт.
const mkNative = (ruleDirName, concernDirName, ruleId, concernId) => async cwd => {
  const result = await runConcernDetector(
    { dir: join(TEST_DIR, '..', 'rules', ruleDirName, concernDirName) },
    { cwd, ruleId, concernId, files: undefined }
  )
  return result.violations.length === 0 ? 0 : 1
}
const checkAbieFirebase = mkNative('abie', 'firebase_hosting', 'abie', 'firebase_hosting')
const checkAbieEnv = mkNative('abie', 'env_dns', 'abie', 'env_dns')
const checkAbieHc = mkNative('abie', 'hc_pairing', 'abie', 'hc_pairing')
const checkAbieUaNs = mkNative('abie', 'ua_node_selector', 'abie', 'ua_node_selector')
const checkAbieUaHr = mkNative('abie', 'ua_http_route', 'abie', 'ua_http_route')
const checkText = mkNative('text', 'formatting', 'text', 'formatting')
const checkDocker = mkNative('docker', 'lint', 'docker', 'lint')
const checkGraphql = mkNative('graphql', 'tooling', 'graphql', 'tooling')

// `bun/layout`, `js/check`, `js-run/runtime`, `npm-module/package_structure` —
// wasm-портовані концерни плагіна lang-js (`crates/plugin-lang-js/src/lib.rs`):
// їхні `main.mjs` прибрано разом з рештою JS-фолбеку, канон тепер wasm.
//
// `runConcernDetector`/`mkNative` тут НЕ підходять, хоч і виглядають тим самим
// патерном, що для native-концернів вище: їхній резолв іде через
// `resolveWasmConcernMap`, який читає `npm/wasm-plugins/builtin-pins.json` —
// білд-артефакт npm-релізу, якого в чистому dev-checkout немає. Тому прямий
// `runWasmConcern` на щойно зібраний компонент (той самий шлях, що
// `npm/tests/check-rule-fixtures.test.mjs` і
// `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`).
const WASM_PATH = join(realRepoRoot(), 'target', 'wasm32-wasip3', 'release', 'plugin_lang_js.wasm')
const mkWasm = concernKey => async cwd => {
  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `integration-repo-checks.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
        'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
    )
  }
  const result = loadNative().runWasmConcern(WASM_PATH, concernKey, cwd, null)
  return result.violations.length === 0 ? 0 : 1
}
const checkBun = mkWasm('bun/layout')
const checkJsLint = mkWasm('js/check')
const checkJsRun = mkWasm('js-run/runtime')
const checkNpmModule = mkWasm('npm-module/package_structure')

// `ga/workflows` — так само wasm-портований концерн, але ІНШОГО гостя
// (`crates/plugin-ci-github`, не `plugin-lang-js`) і з `exec-tool`-ланцюжком —
// ЧОТИРИ задекларовані тули (`plugin.toml`: `tools = ["path:git",
// "npm:github-actionlint", "path:uvx", "shellcheck"]`), не два. `ToolResolver`
// (`crates/rules-plugin-host/src/tool_resolver.rs`) резолвить ВИКЛЮЧНО з явної
// мапи `toolPaths` — жодного фолбеку на PATH усередині wasmtime-хоста немає
// (`exec-tool` нічого не добуває). Раніше тут вручну збирався `toolPaths` лише
// з `git`+`shellcheck` — `actionlint`/`zizmor` (`npm:github-actionlint`/
// `path:uvx`) лишались поза мапою й падали на `*-unavailable` (§2.29), хоча
// обидва тули в системі Є (`node_modules/.bin/github-actionlint`, `uvx` у PATH).
//
// Продакшн-шлях резолву — `resolveWasmConcernMap` (`wasm-plugins.mjs`): та сама
// `ensureDeclaredTools` (схеми `path:`/`npm:`/pinned), що й справжній
// `n-rules lint`. Пряме `resolveWasmConcernMap(REPO_ROOT)` тут не спрацювало б
// «з коробки» — чистий dev-checkout не має ні `npm/wasm-plugins/builtin-pins.json`
// (build-артефакт релізу, генерує `build-wasm-plugins.mjs`), ні секції
// `wasmPlugins` у кореневому `.n-rules.json` (додавати її туди — змінювати
// диспатч РЕАЛЬНОГО `n-rules lint`, поза обсягом цього тесту), тож
// `resolveWasmConcernMap(REPO_ROOT)` без допомоги повернув би ПОРОЖНЮ мапу.
// Замість дублювання `ensureDeclaredTools`/`parseToolRef` тут — тимчасовий
// builtin-пін (`{cwd: REPO_ROOT, builtinPinsDir: <tmp>}`), що вказує на вже
// зібраний `WASM_CI_GITHUB_PATH`: builtin-схема (`resolveBuiltinEntryPath`) не
// залежить від `CI`-env (на відміну від dev-`path:`-піна консюмера), а
// `cwd: REPO_ROOT` (не tmp-каталог) лишає `npm:`-резолв (`node_modules/.bin`)
// коректним. Одна СПРАВЖНЯ функція продакшн-резолву, лише вхідні дані — dev-петля.
//
// Модульний кеш `resolveWasmConcernMap` — ОДИН на процес незалежно від `cwd`
// (`detect.mjs` кличе його для кожного `check*` вище через `runConcernDetector`),
// тож `resetWasmConcernMapForTests()` і до, і після: без «до» лишок кешу
// попереднього check-у сховав би наш tmp-пін; без «після» наш ci-github-пін
// протік би в резолв решти check-ів нижче (`checkGraphql`/`checkText`/…).
const WASM_CI_GITHUB_PATH = join(realRepoRoot(), 'target', 'wasm32-wasip3', 'release', 'plugin_ci_github.wasm')
const checkGa = async cwd => {
  if (!existsSync(WASM_CI_GITHUB_PATH)) {
    throw new Error(
      `integration-repo-checks.test.mjs: wasm-компонент plugin-ci-github не зібраний: ${WASM_CI_GITHUB_PATH} відсутній.\n` +
        'Зберіть його командою: bash crates/plugin-ci-github/build.sh'
    )
  }
  let toolPaths
  resetWasmConcernMapForTests()
  try {
    await withTmpDir(async pinsDir => {
      const destFile = 'plugin_ci_github.wasm'
      await copyFile(WASM_CI_GITHUB_PATH, join(pinsDir, destFile))
      const sha256 = createHash('sha256').update(await readFile(join(pinsDir, destFile))).digest('hex')
      await writeJson(join(pinsDir, 'builtin-pins.json'), { 'ci-github': { file: destFile, sha256 } })
      const concernMap = await resolveWasmConcernMap(realRepoRoot(), {
        builtinPinsDir: pinsDir,
        // `shellcheck` — pinned-схема (без префікса в `plugin.toml`), тож
        // резолв іде через `ensureToolFn`, не `resolveCmdFn` (той — лише для
        // `path:`/`npm:`). REAL_SHELLCHECK_PATH обходить стаб
        // `withShellcheckStubInPath`, що обгортає тіло тесту нижче (доккомент
        // константи вище); фолбек на реальний `ensureToolAsync` — якщо
        // машина взагалі без shellcheck, поведінка та сама, що без цього override.
        ensureToolFn: async toolId =>
          toolId === 'shellcheck' && REAL_SHELLCHECK_PATH ? REAL_SHELLCHECK_PATH : ensureToolAsync(toolId)
      })
      const entry = concernMap.get('ga/workflows')
      if (!entry) {
        throw new Error(
          'integration-repo-checks.test.mjs: resolveWasmConcernMap не резолвив ga/workflows з тимчасового builtin-піна ' +
            `(${WASM_CI_GITHUB_PATH}) — перевір wasm-компонент/sha256.`
        )
      }
      toolPaths = entry.toolPaths
    })
  } finally {
    resetWasmConcernMapForTests()
  }
  const stubbedPath = env.PATH
  env.PATH = REAL_PATH
  let result
  try {
    result = loadNative().runWasmConcern(WASM_CI_GITHUB_PATH, 'ga/workflows', cwd, null, toolPaths)
  } finally {
    env.PATH = stubbedPath
  }
  return result.violations.length === 0 ? 0 : 1
}

/**
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<number>} exit code abie-check chain на заданому cwd
 */
async function checkAbie(cwd) {
  let code = 0
  for (const fn of [checkAbieFirebase, checkAbieHc, checkAbieEnv, checkAbieUaNs, checkAbieUaHr]) {
    if ((await fn(cwd)) !== 0) code = 1
  }
  return code
}

// §2.31 (реєстр відкритих питань, ревізія «оживи вічно-пропущені набори»): цей блок був
// БЕЗУМОВНИМ `describe.skip` із коментарем «re-enable після Phase 6
// repo-conformance cleanup» — «Phase 6» тут посилається на комміт f79750f93
// («unified lint surface: Phase 6 — migrate test suite to lint(ctx)»,
// 2026-06-30), не на фази спеки `rules-v2-rust-core-migration`. Той коміт
// мігрував ~800 concern-тестів на контракт `lint(ctx)→{violations}` і
// відклав ЦЕЙ файл «до repo-conformance cleanup» — окремого коміту з такою
// назвою в історії репозиторію НЕМАЄ, а всі 10 check-функцій нижче вже давно
// диспатчаться через `runConcernDetector`/`runWasmConcern` (той самий
// контракт, що мігрував f79750f93) — сама причина skip-у застаріла. Внутрішній
// `if (env.STRYKER_MUTATOR_WORKER) return` (доккомент нижче) лишається —
// це чинна, а не застаріла умова.
describe('check-* на реальному репозиторії (§2.31: re-enable, Phase 6 repo-conformance cleanup — застаріла причина)', () => {
  // 10 послідовних checks з subprocess-викликами (shellcheck-стаб, k8s/ga/text валідатори
  // через conftest/opa/regal) на macOS вкладаються у ~5-7с — дефолтний 5000ms-timeout bun-test'у
  // не вистачає. Збільшуємо до 120с: у стані з великим git-diff (напр. відновлені файли після
  // bad commit) деякі checks (checkK8s, checkJsRun) можуть займати до 60-90с.
  //
  // Skip під Stryker (`STRYKER_MUTATOR_WORKER`): Stryker копіює репо у `reports/stryker/.tmp/
  // sandbox-XXX/` і запускає тести звідти. `REPO_ROOT` computed з `import.meta.dirname` резолвиться
  // у sandbox-копію, а перевірки на кшталт `checkK8s` / `checkJsRun` вимагають реального `.git/`
  // або subprocess-валідаторів — у sandbox вони не виконуються коректно і обривають Stryker
  // dry-run. Для unit-pure mutation analysis інтеграційний тест проти живого дерева не несе
  // додаткової інформації понад те, що дають per-rule unit-тести.
  test('узгоджені з поточним деревом cursor', async () => {
    // Під Stryker (`STRYKER_MUTATOR_WORKER`) — no-op: REPO_ROOT резолвиться у sandbox-копію
    // (див. коментар вище), тож інтеграційний прогон проти живого дерева тут пропускаємо.
    if (env.STRYKER_MUTATOR_WORKER) return
    // §2.31: раніше — 10 незалежних `expect(...).toBe(0)` поспіль. Перший-таки
    // fail (`checkGraphql`, доккомент нижче) обривав `expect` одразу й ховав
    // решту: `checkK8s`/`checkJsRun` фактично теж червоні на живому дереві
    // (перевірено окремим прогоном без early-abort), але жодного разу не
    // зʼявлялись у звіті — сама структура тесту приховувала дві третини
    // проблем позаду першої. Збираємо всі 10 результатів і фейлимо ОДНИМ
    // `expect` зі списком імен, що впали — так репортер завжди показує
    // ПОВНУ картину, не лише перший збіг.
    await withShellcheckStubInPath(async () => {
      const results = {
        checkAbie: await checkAbie(REPO_ROOT),
        checkBun: await checkBun(REPO_ROOT),
        checkGa: await checkGa(REPO_ROOT),
        checkGraphql: await checkGraphql(REPO_ROOT),
        checkJsLint: await checkJsLint(REPO_ROOT),
        checkText: await checkText(REPO_ROOT),
        checkNpmModule: await checkNpmModule(REPO_ROOT),
        checkDocker: await checkDocker(REPO_ROOT),
        checkK8s: await checkK8s(REPO_ROOT),
        checkJsRun: await checkJsRun(REPO_ROOT)
      }
      const failed = Object.entries(results)
        .filter(([, code]) => code !== 0)
        .map(([name]) => name)
      // §2.31/§2.32 (реєстр відкритих питань): на момент реанімації (§2.31)
      // тут падали чотири з десяти — `checkGa` виявився прогалиною тестового
      // харнеса (`toolPaths` збирався вручну лише з `git`+`shellcheck`,
      // хоча `plugin.toml` декларує чотири тули — доккомент `checkGa` вище),
      // решта три — реальні невідповідності репозиторію (§2.32, полагоджено):
      // `checkGraphql` — репо мало `gql\`…\`` у тестових фікстурах детектора
      // (сам фікстур-скан і є другим живим споживачем `gql`-паттерна) без
      // `.graphqlrc.yml`/`graphql.vscode-graphql` (додано); `checkK8s` —
      // `npm/rules/k8s/network_policy/template/*.snippet.yaml` (NetworkPolicy
      // `spec:`-фрагменти без `apiVersion`/`kind`, kubescape не міг їх
      // розпарсити як ресурс) і `plugins/ci-github/rules/k8s/lint_k8s_yml/
      // template/lint-k8s.yml.snippet.yml` (GHA workflow-шаблон, а не k8s-
      // маніфест — сегмент шляху `k8s` false-positive-ив manifest-скан) —
      // обидва не реальний k8s-контент цього репо, виключені через
      // `.n-rules.json` `ignore` (той самий канал, що вже несе
      // `.claude/worktrees`/`npm/schemas/vendor`); `checkJsRun` — чотири
      // тестові файли (три з переліку задачі §2.32 плюс сам цей файл, рядок
      // з `N_RULES_PACKAGE_ROOT` вище) читали `process.env.X` напряму замість
      // `env` з `node:process` (js-run.mdc, опційна змінна) — виправлено.
      expect(failed).toEqual([])
    })
  }, 120000)
})
