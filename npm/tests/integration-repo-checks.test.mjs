/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { main as checkAbieFirebase } from '../rules/abie/firebase_hosting/main.mjs'
import { main as checkAbieHc } from '../rules/abie/hc_pairing/main.mjs'
import { main as checkAbieEnv } from '../rules/abie/env_dns/main.mjs'
import { main as checkAbieUaNs } from '../rules/abie/ua_node_selector/main.mjs'
import { main as checkAbieUaHr } from '../rules/abie/ua_http_route/main.mjs'
import { main as checkBun } from '../rules/bun/layout/main.mjs'
import { main as checkDocker } from '../rules/docker/lint/main.mjs'
import { main as checkGa } from '../rules/ga/workflows/main.mjs'
import { main as checkGraphql } from '../rules/graphql/tooling/main.mjs'
import { main as checkJsLint } from '../rules/js/check/main.mjs'
import { main as checkText } from '../rules/text/formatting/main.mjs'
import { main as checkJsRun } from '../rules/js-run/runtime/main.mjs'
import { main as checkK8s } from '../rules/k8s/manifests/main.mjs'
import { main as checkNpmModule } from '../rules/npm-module/package_structure/main.mjs'
import { withShellcheckStubInPath } from '../scripts/utils/test-helpers.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

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

describe('check-* на реальному репозиторії', () => {
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
