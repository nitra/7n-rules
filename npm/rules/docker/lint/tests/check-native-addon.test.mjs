/**
 * Тести правила «нативний .node-аддон не компілювати» end-to-end через `check()` із реальним
 * package.json + Dockerfile, і unit-перевірка дозволу oven/bun як фінального runtime для аддонів.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint, getMultistageAndRuntimeHint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const check = async dir => {
  const r = await lint({ cwd: dir, ruleId: 'docker', concernId: 'lint', files: undefined })
  return r.violations
}

const HADOLINT_RELAX = 'failure-threshold: error\n'

const ANTIPATTERN_DOCKERFILE = [
  'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
  'WORKDIR /app',
  'COPY package.json .',
  'RUN bun install --production',
  'COPY ./src ./src',
  'RUN bun build --compile --outfile app ./src/index.js',
  'FROM mirror.gcr.io/library/alpine:latest',
  'RUN apk add --no-cache libstdc++ libgcc vips tzdata',
  'COPY --from=build-env --chown=app:app /app/app ./app',
  'USER app',
  'CMD ["./app"]',
  ''
].join('\n')

const CANON_DOCKERFILE = [
  'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
  'WORKDIR /app',
  'ENV NODE_ENV=production',
  'COPY package.json .',
  'RUN bun install --production',
  'COPY ./src ./src',
  'FROM mirror.gcr.io/oven/bun:alpine',
  'RUN apk add --no-cache tzdata',
  'WORKDIR /app',
  'COPY --from=build-env --chown=bun:bun /app/node_modules ./node_modules',
  'COPY --from=build-env --chown=bun:bun /app/src ./src',
  'COPY --from=build-env --chown=bun:bun /app/package.json ./package.json',
  'USER bun',
  'CMD ["bun", "src/index.js"]',
  ''
].join('\n')

describe('check() — нативний аддон + compile', () => {
  test('антипатерн (sharp + bun build --compile) → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.hadolint.yaml'), HADOLINT_RELAX, 'utf8')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { sharp: '^0.34.5' } }), 'utf8')
      await writeFile(join(dir, 'Dockerfile'), ANTIPATTERN_DOCKERFILE, 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  test('канон (sharp, node_modules + bun, final oven/bun) → exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.hadolint.yaml'), HADOLINT_RELAX, 'utf8')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { sharp: '^0.34.5' } }), 'utf8')
      await writeFile(join(dir, 'Dockerfile'), CANON_DOCKERFILE, 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('регрес: без нативних аддонів + compile (alpine binary) → правило мовчить, exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.hadolint.yaml'), HADOLINT_RELAX, 'utf8')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { pino: '^9' } }), 'utf8')
      await writeFile(join(dir, 'Dockerfile'), ANTIPATTERN_DOCKERFILE, 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })
})

describe('getMultistageAndRuntimeHint — oven/bun runtime для нативних аддонів', () => {
  test('hasNativeAddon: фінальний oven/bun дозволено → null', () => {
    const h = getMultistageAndRuntimeHint(CANON_DOCKERFILE, { hasNativeAddon: true })
    expect(h).toBe(null)
  })

  test('без hasNativeAddon: фінальний oven/bun заборонено (як і раніше)', () => {
    const h = getMultistageAndRuntimeHint(CANON_DOCKERFILE)
    expect(h).toContain('дозволеним runtime-образом')
    expect(h).toContain('oven/bun')
  })
})
