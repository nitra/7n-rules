/**
 * Інтеграційні тести: check-* проти кореня репозиторію nitra/cursor (без правил, що тут навмисно не застосовані).
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check as checkAbie } from '../scripts/check-abie.mjs'
import { check as checkBun } from '../scripts/check-bun.mjs'
import { check as checkDocker } from '../scripts/check-docker.mjs'
import { check as checkGa } from '../scripts/check-ga.mjs'
import { check as checkGraphql } from '../scripts/check-graphql.mjs'
import { check as checkJsLint } from '../scripts/check-js-lint.mjs'
import { check as checkText } from '../scripts/check-text.mjs'
import { check as checkJsRun } from '../scripts/check-js-run.mjs'
import { check as checkK8s } from '../scripts/check-k8s.mjs'
import { check as checkNpmModule } from '../scripts/check-npm-module.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

describe('check-* на реальному репозиторії', () => {
  test('узгоджені з поточним деревом cursor', async () => {
    const prev = process.cwd()
    process.chdir(REPO_ROOT)
    try {
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
    } finally {
      process.chdir(prev)
    }
  })
})
