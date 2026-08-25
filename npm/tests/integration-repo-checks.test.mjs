/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { existsSync } from 'node:fs'

import { runConcernDetector } from '../scripts/lib/lint-surface/detect.mjs'
import { loadNative } from '../scripts/lib/native.mjs'
import { realRepoRoot, withShellcheckStubInPath } from '../scripts/utils/test-helpers.mjs'
import { resolveCmd } from '../scripts/utils/resolve-cmd.mjs'

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
// цей випадок (`rules_package.rs`).
process.env.N_RULES_PACKAGE_ROOT ??= join(REPO_ROOT, 'npm')

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
const WASM_PATH = join(realRepoRoot(), 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js.wasm')
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
// (`crates/plugin-ci-github`, не `plugin-lang-js`) і з `exec-tool`-ланцюжком
// (`git`/`shellcheck` — доккомент `wasm-plugin-parity-ci-github.test.mjs`),
// тож не `mkWasm` (той жорстко зашитий на `plugin_lang_js.wasm` і не передає
// `toolPaths`). `actionlint`/`zizmor` тут НЕ підмінюються — реальний
// dev-checkout їх має в PATH (`toolPaths` без ключів → host сам резолвить
// `bunx`/`uvx` з PATH, той самий канал, що продакшн `n-rules lint`).
const WASM_CI_GITHUB_PATH = join(realRepoRoot(), 'target', 'wasm32-wasip2', 'release', 'plugin_ci_github.wasm')
const checkGa = async cwd => {
  if (!existsSync(WASM_CI_GITHUB_PATH)) {
    throw new Error(
      `integration-repo-checks.test.mjs: wasm-компонент plugin-ci-github не зібраний: ${WASM_CI_GITHUB_PATH} відсутній.\n` +
        'Зберіть його командою: bash crates/plugin-ci-github/build.sh'
    )
  }
  const toolPaths = {}
  const git = resolveCmd('git')
  if (git) toolPaths.git = git
  const shellcheck = resolveCmd('shellcheck')
  if (shellcheck) toolPaths.shellcheck = shellcheck
  const result = loadNative().runWasmConcern(WASM_CI_GITHUB_PATH, 'ga/workflows', cwd, null, toolPaths)
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

describe.skip('check-* на реальному репозиторії (re-enable після Phase 6 repo-conformance cleanup)', () => {
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
    await withShellcheckStubInPath(async () => {
      expect(await checkAbie(REPO_ROOT)).toBe(0)
      expect(await checkBun(REPO_ROOT)).toBe(0)
      expect(await checkGa(REPO_ROOT)).toBe(0)
      expect(await checkGraphql(REPO_ROOT)).toBe(0)
      expect(await checkJsLint(REPO_ROOT)).toBe(0)
      expect(await checkText(REPO_ROOT)).toBe(0)
      expect(await checkNpmModule(REPO_ROOT)).toBe(0)
      expect(await checkDocker(REPO_ROOT)).toBe(0)
      expect(await checkK8s(REPO_ROOT)).toBe(0)
      expect(await checkJsRun(REPO_ROOT)).toBe(0)
    })
  }, 120000)
})
