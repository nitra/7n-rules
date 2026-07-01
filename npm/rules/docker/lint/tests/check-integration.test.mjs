/**
 * Інтеграційні тести `check()` з реальними temp-директоріями та Dockerfile-ами.
 * Покриває lines 303-345: for-цикл, checkDockerfile, hadolint-шлях.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const check = async dir => {
  const r = await lint({ cwd: dir, ruleId: 'docker', concernId: 'lint', files: undefined })
  return r.violations
}

const CLEAN_MULTISTAGE = [
  'FROM mirror.gcr.io/library/alpine:3.19 AS build',
  'RUN echo build',
  '',
  'FROM mirror.gcr.io/library/alpine:3.19',
  'USER nobody',
  'COPY --from=build /etc/alpine-release /app/',
  'CMD ["/bin/sh"]',
  ''
].join('\n')

const SINGLE_STAGE = 'FROM mirror.gcr.io/library/alpine:latest\nCMD ["/bin/sh"]\n'

describe('check() integration', () => {
  test('порожній каталог — немає Dockerfile → exit 0', async () => {
    await withTmpDir(async dir => {
      const violations = await check(dir)
      expect(violations).toEqual([])
    })
  })

  test('multistage Dockerfile без порушень → exit 0', async () => {
    await withTmpDir(async dir => {
      // failure-threshold: error — лише справжні помилки hadolint призводять до fail
      await writeFile(join(dir, '.hadolint.yaml'), 'failure-threshold: error\n', 'utf8')
      await writeFile(join(dir, 'Dockerfile'), CLEAN_MULTISTAGE, 'utf8')
      const violations = await check(dir)
      expect(violations).toEqual([])
    })
  })

  test('single-stage Dockerfile → multistage fail → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Dockerfile'), SINGLE_STAGE, 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  test('кілька Dockerfile: один clean, один порушує → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.hadolint.yaml'), 'failure-threshold: error\n', 'utf8')
      await writeFile(join(dir, 'Dockerfile'), CLEAN_MULTISTAGE, 'utf8')
      await writeFile(join(dir, 'Dockerfile.app'), SINGLE_STAGE, 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
