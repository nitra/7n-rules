/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applies as appliesAbie } from '../rules/abie/fix/applies/check.mjs'
import { check as checkAbieFirebase } from '../rules/abie/fix/firebase_hosting/check.mjs'
import { check as checkAbieHc } from '../rules/abie/fix/hc_pairing/check.mjs'
import { check as checkAbieEnv } from '../rules/abie/fix/env_dns/check.mjs'
import { check as checkAbieUaNs } from '../rules/abie/fix/ua_node_selector/check.mjs'
import { check as checkAbieUaHr } from '../rules/abie/fix/ua_http_route/check.mjs'
import { check as checkBun } from '../rules/bun/fix/layout/check.mjs'
import { check as checkDocker } from '../rules/docker/fix/lint/check.mjs'
import { check as checkGa } from '../rules/ga/fix/workflows/check.mjs'
import { check as checkGraphql } from '../rules/graphql/fix/tooling/check.mjs'
import { check as checkJsLint } from '../rules/js-lint/fix/tooling/check.mjs'
import { check as checkText } from '../rules/text/fix/formatting/check.mjs'
import { check as checkJsRun } from '../rules/js-run/fix/runtime/check.mjs'
import { check as checkK8s } from '../rules/k8s/fix/manifests/check.mjs'
import { check as checkNpmModule } from '../rules/npm-module/fix/package_structure/check.mjs'
import { withShellcheckStubInPath } from '../scripts/utils/test-helpers.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

describe('check-* на реальному репозиторії', () => {
  test('узгоджені з поточним деревом cursor', async () => {
    const prev = process.cwd()
    process.chdir(REPO_ROOT)
    try {
      const checkAbie = async () => {
        if (!(await appliesAbie())) return 0
        let code = 0
        for (const fn of [checkAbieFirebase, checkAbieHc, checkAbieEnv, checkAbieUaNs, checkAbieUaHr]) {
          if ((await fn()) !== 0) code = 1
        }
        return code
      }
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
  })
})
