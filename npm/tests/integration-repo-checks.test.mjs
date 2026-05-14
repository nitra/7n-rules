/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check as checkAbie } from '../rules/abie/js/check.mjs'
import { check as checkBun } from '../rules/bun/js/check.mjs'
import { check as checkDocker } from '../rules/docker/js/check.mjs'
import { check as checkGa } from '../rules/ga/js/check.mjs'
import { check as checkGraphql } from '../rules/graphql/js/check.mjs'
import { check as checkJsLint } from '../rules/js-lint/js/check.mjs'
import { check as checkText } from '../rules/text/js/check.mjs'
import { check as checkJsRun } from '../rules/js-run/js/check.mjs'
import { check as checkK8s } from '../rules/k8s/js/check.mjs'
import { check as checkNpmModule } from '../rules/npm-module/js/check.mjs'
import { withShellcheckStubInPath } from '../scripts/utils/test-helpers.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

describe('check-* на реальному репозиторії', () => {
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
  })
})
