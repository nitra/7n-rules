/**
 * Тести вимоги non-root у фінальному runtime stage.
 */
import { describe, expect, test } from 'vitest'

import { getNonRootRuntimeHint } from '../../../lint.mjs'

describe('getNonRootRuntimeHint', () => {
  test('ok: USER app у фінальному stage', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'RUN addgroup -g 1000 app && adduser -D -u 1000 -G app app',
        'COPY --from=build-env --chown=app:app /app/app ./app',
        'USER app',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('fail: немає USER у фінальному stage', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toContain('USER')
    expect(h).toContain('non-root')
  })

  test('fail: USER root', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'USER root',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toContain('root')
  })

  test('fail: USER 0', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'USER 0',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toContain('USER 0')
  })

  test('ok: nginx-unprivileged без USER — вже non-root за замовчуванням', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun run build',
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'COPY --from=build-env /app/dist /usr/share/nginx/html'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('ok: nginx-unprivileged з USER root → USER nginx', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
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

  test('fail: nginx-unprivileged з USER root як фінальний', () => {
    const h = getNonRootRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun run build',
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'USER root'
      ].join('\n')
    )
    expect(h).toContain('root')
  })
})
