/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applies as appliesAbie } from '../rules/abie/js/applies.mjs'
import { check as checkAbieFirebase } from '../rules/abie/js/firebase_hosting.mjs'
import { check as checkAbieHc } from '../rules/abie/js/hc_pairing.mjs'
import { check as checkAbieEnv } from '../rules/abie/js/env_dns.mjs'
import { check as checkAbieUaNs } from '../rules/abie/js/ua_node_selector.mjs'
import { check as checkAbieUaHr } from '../rules/abie/js/ua_http_route.mjs'
import { check as checkBun } from '../rules/bun/js/layout.mjs'
import { check as checkDocker } from '../rules/docker/js/lint.mjs'
import { check as checkGa } from '../rules/ga/js/workflows.mjs'
import { check as checkGraphql } from '../rules/graphql/js/tooling.mjs'
import { check as checkJsLint } from '../rules/js-lint/js/tooling.mjs'
import { check as checkText } from '../rules/text/js/formatting.mjs'
import { check as checkJsRun } from '../rules/js-run/js/runtime.mjs'
import { check as checkK8s } from '../rules/k8s/js/manifests.mjs'
import { check as checkNpmModule } from '../rules/npm-module/js/package_structure.mjs'
import { withShellcheckStubInPath } from '../scripts/utils/test-helpers.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

/** @returns {Promise<number>} exit code abie-check chain на поточному cwd */
async function checkAbie() {
  if (!(await appliesAbie())) return 0
  let code = 0
  for (const fn of [checkAbieFirebase, checkAbieHc, checkAbieEnv, checkAbieUaNs, checkAbieUaHr]) {
    if ((await fn()) !== 0) code = 1
  }
  return code
}

describe('check-* на реальному репозиторії', () => {
  // 10 послідовних checkов з subprocess-викликами (shellcheck-стаб, k8s/ga/text валідатори
  // через conftest/opa/regal) на macOS вкладаються у ~5-7с — дефолтний 5000ms-timeout bun-test'у
  // не вистачає. Збільшуємо до 120с: у стані з великим git-diff (напр. відновлені файли після
  // bad commit) деякі checks (checkK8s, checkJsRun) можуть займати до 60-90с.
  test('узгоджені з поточним деревом cursor', async () => {
    const prev = process.cwd()
    process.chdir(REPO_ROOT)
    try {
      await withShellcheckStubInPath(async () => {
        expect(await checkAbie()).toBe(0)
        expect(await checkBun()).toBe(0)
        expect(await checkGa()).toBe(0)
        expect(await checkGraphql()).toBe(0)
        expect(await checkJsLint()).toBe(0)
        expect(await checkText()).toBe(0)
        expect(await checkNpmModule()).toBe(0)
        expect(await checkDocker()).toBe(0)
        expect(await checkK8s()).toBe(0)
        expect(await checkJsRun()).toBe(0)
      })
    } finally {
      process.chdir(prev)
    }
  }, 120000)
})
