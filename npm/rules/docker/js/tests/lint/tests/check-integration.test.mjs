/**
 * Інтеграційні тести `check()` з реальними temp-директоріями та Dockerfile-ами.
 * Покриває lines 303-345: for-цикл, checkDockerfile, hadolint-шлях.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../../../lint.mjs'
import { withTmpDir } from '../../../../../../scripts/utils/test-helpers.mjs'

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
      const code = await check(dir)
      expect(code).toBe(0)
    })
  })

  test('multistage Dockerfile без порушень → exit 0', async () => {
    await withTmpDir(async dir => {
      // failure-threshold: error — лише справжні помилки hadolint призводять до fail
      await writeFile(join(dir, '.hadolint.yaml'), 'failure-threshold: error\n', 'utf8')
      await writeFile(join(dir, 'Dockerfile'), CLEAN_MULTISTAGE, 'utf8')
      const code = await check(dir)
      expect(code).toBe(0)
    })
  })

  test('single-stage Dockerfile → multistage fail → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Dockerfile'), SINGLE_STAGE, 'utf8')
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })

  test('кілька Dockerfile: один clean, один порушує → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.hadolint.yaml'), 'failure-threshold: error\n', 'utf8')
      await writeFile(join(dir, 'Dockerfile'), CLEAN_MULTISTAGE, 'utf8')
      await writeFile(join(dir, 'Dockerfile.app'), SINGLE_STAGE, 'utf8')
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })
})
