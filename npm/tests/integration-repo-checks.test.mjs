/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../scripts/lib/lint-surface/detect.mjs'
import { lint as _abieHc } from '../rules/abie/hc_pairing/main.mjs'
import { lint as _abieUaNs } from '../rules/abie/ua_node_selector/main.mjs'
import { lint as _abieUaHr } from '../rules/abie/ua_http_route/main.mjs'
// Плагінні правила — пакетними specifier-ами, не `../../plugins/…`: sandbox-копія
// Stryker містить лише npm/, відносний шлях там не резолвиться.
import { lint as _bun } from '@7n/rules-lang-js/rules/bun/layout/main.mjs'
import { lint as _docker } from '../rules/docker/lint/main.mjs'
import { lint as _ga } from '@7n/rules-ci-github/rules/ga/workflows/main.mjs'
import { lint as _graphql } from '../rules/graphql/tooling/main.mjs'
import { lint as _jsLint } from '@7n/rules-lang-js/rules/js/check/main.mjs'
import { lint as _text } from '../rules/text/formatting/main.mjs'
import { lint as _jsRun } from '@7n/rules-lang-js/rules/js-run/runtime/main.mjs'
import { lint as _k8s } from '../rules/k8s/manifests/main.mjs'
import { lint as _npmModule } from '@7n/rules-lang-js/rules/npm-module/package_structure/main.mjs'
import { withShellcheckStubInPath } from '../scripts/utils/test-helpers.mjs'

// Адаптери під unified lint surface: detector → 0 (чисто) / 1 (є violations).
const mk = (fn, ruleId, concernId) => async cwd => {
  const result = await fn({ cwd, ruleId, concernId })
  return result.violations.length === 0 ? 0 : 1
}
const checkAbieHc = mk(_abieHc, 'abie', 'hc_pairing')
const checkAbieUaNs = mk(_abieUaNs, 'abie', 'ua_node_selector')
const checkAbieUaHr = mk(_abieUaHr, 'abie', 'ua_http_route')
const checkBun = mk(_bun, 'bun', 'layout')
const checkDocker = mk(_docker, 'docker', 'lint')
const checkGa = mk(_ga, 'ga', 'workflows')
const checkGraphql = mk(_graphql, 'graphql', 'tooling')
const checkJsLint = mk(_jsLint, 'js', 'check')
const checkText = mk(_text, 'text', 'formatting')
const checkJsRun = mk(_jsRun, 'js-run', 'runtime')
const checkK8s = mk(_k8s, 'k8s', 'manifests')
const checkNpmModule = mk(_npmModule, 'npm-module', 'package_structure')

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

// firebase_hosting і env_dns — native-портовані concern-и (F1 фази 5 батчу 2):
// `main.mjs` видалено, лишається лише native-реєстр (`crates/rules-core`), тож
// диспатч тут — через `runConcernDetector` (той самий шлях, що й dispatch-рівень
// concern-тестів), а не прямий `lint()`-імпорт.
const mkNative = (dirName, ruleId, concernId) => async cwd => {
  const result = await runConcernDetector(
    { dir: join(TEST_DIR, '..', 'rules', 'abie', dirName) },
    { cwd, ruleId, concernId, files: undefined }
  )
  return result.violations.length === 0 ? 0 : 1
}
const checkAbieFirebase = mkNative('firebase_hosting', 'abie', 'firebase_hosting')
const checkAbieEnv = mkNative('env_dns', 'abie', 'env_dns')

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
