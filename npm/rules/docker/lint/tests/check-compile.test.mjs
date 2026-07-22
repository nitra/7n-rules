/**
 * Тести вимоги компіляції (bun build --compile) для backend Dockerfile з bun install.
 */
import { describe, expect, test } from 'vitest'

import { getBunCompileHint, hasBunNoCompileMarker } from '../main.mjs'

describe('getBunCompileHint', () => {
  test('ok: bun install + bun build --compile + final alpine без bun', () => {
    const h = getBunCompileHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'WORKDIR /app',
        'COPY package.json .',
        'COPY bunfig.toml .',
        'RUN bun install --production',
        'COPY ./src ./src',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'RUN apk add --no-cache libstdc++ libgcc tzdata',
        'WORKDIR /app',
        'COPY --from=build-env /app/app ./app',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('fail: bun install + final alpine, але немає bun build --compile', () => {
    const h = getBunCompileHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun install --production',
        'FROM mirror.gcr.io/library/alpine:latest',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toContain('bun build --compile')
  })

  test('fail: compile є, але у фінальному stage лишився bun', () => {
    const h = getBunCompileHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun install --production',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'CMD ["bun","./app"]'
      ].join('\n')
    )
    expect(h).toContain('фінальний stage')
    expect(h).toContain('Bun')
  })

  test('skip: bun install, але фінальний stage nginx (frontend)', () => {
    const h = getBunCompileHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun install',
        'RUN bun run build',
        'FROM mirror.gcr.io/library/nginx:alpine-slim'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('skip: bun install, але фінальний stage nginx-unprivileged (frontend)', () => {
    const h = getBunCompileHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun install',
        'RUN bun run build',
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'USER root',
        'COPY --from=build-env /app/dist /usr/share/nginx/html',
        'RUN chown -R nginx:nginx /usr/share/nginx/html',
        'USER nginx'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('skip: bun install без bun build --compile, але є bun-no-compile-маркер', () => {
    const h = getBunCompileHint(
      [
        '# bun-no-compile: gateway.config.js вантажиться через динамічний import(), compile не трейсить його',
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun install --production',
        'FROM mirror.gcr.io/library/alpine:latest',
        'CMD ["bun", "src/index.js"]'
      ].join('\n')
    )
    expect(h).toBe(null)
  })
})

describe('hasBunNoCompileMarker', () => {
  test('true: коментар-рядок bun-no-compile з причиною', () => {
    expect(hasBunNoCompileMarker('# bun-no-compile: причина\nFROM mirror.gcr.io/oven/bun:alpine')).toBe(true)
  })

  test('true: маркер з провідними пробілами', () => {
    expect(hasBunNoCompileMarker('  # bun-no-compile: причина')).toBe(true)
  })

  test('false: маркер без причини (порожньо після двокрапки)', () => {
    expect(hasBunNoCompileMarker('# bun-no-compile:')).toBe(false)
  })

  test('false: маркера немає взагалі', () => {
    expect(hasBunNoCompileMarker('FROM mirror.gcr.io/oven/bun:alpine\nRUN bun install')).toBe(false)
  })
})
