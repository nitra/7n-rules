/**
 * Тести вимоги компіляції (bun build --compile) для backend Dockerfile з bun install.
 */
import { describe, expect, test } from 'bun:test'

import { getBunCompileHint } from '../../lint.mjs'

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
})
