/**
 * Тести вимоги multistage build і дозволеного фінального runtime stage (alpine, nginx, scratch, debian slim, …).
 */
import { describe, expect, test } from 'bun:test'

import { getMultistageAndRuntimeHint, parseFromStages } from '../../../lint.mjs'

describe('parseFromStages', () => {
  test('збирає всі FROM з номерами рядків', () => {
    const stages = parseFromStages(
      [
        'ARG X=1',
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun i',
        'FROM mirror.gcr.io/library/alpine:latest',
        'CMD ["./app"]'
      ].join('\n')
    )

    expect(stages).toEqual([
      { line: 2, image: 'mirror.gcr.io/oven/bun:alpine' },
      { line: 4, image: 'mirror.gcr.io/library/alpine:latest' }
    ])
  })
})

describe('getMultistageAndRuntimeHint', () => {
  test('ok: multistage + final alpine', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile app ./src/index.js',
        'FROM mirror.gcr.io/library/alpine:latest',
        'CMD ["./app"]'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('fail: final library/nginx заборонений — потрібен nginxinc/nginx-unprivileged (docker.mdc)', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun x',
        'FROM mirror.gcr.io/library/nginx:alpine-slim',
        'COPY --from=build-env /app/dist /usr/share/nginx/html'
      ].join('\n')
    )
    expect(h).toContain('дозволеним runtime-образом')
    expect(h).toContain('library/nginx')
  })

  test('ok: multistage + final nginx-unprivileged', () => {
    const h = getMultistageAndRuntimeHint(
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

  test('ok: multistage + final php (виняток)', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/library/php:8.3-cli AS build-env',
        'RUN composer install',
        'FROM mirror.gcr.io/library/php:8.3-fpm',
        'COPY --from=build-env /app /var/www/html'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('ok: multistage + final python (виняток)', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/library/python:3.12 AS build-env',
        'RUN pip install -r requirements.txt',
        'FROM mirror.gcr.io/library/python:3.12-slim',
        'COPY --from=build-env /app /app'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('ok: multistage + final scratch', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile /app/a ./x.js',
        'FROM scratch',
        'COPY --from=build-env /app/a /a'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('ok: multistage + final debian bookworm-slim', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build --compile --outfile /app/a ./x.js',
        'FROM mirror.gcr.io/library/debian:bookworm-slim',
        'RUN apt-get update',
        'COPY --from=build-env /app/a /usr/local/bin/a'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('fail: final debian без slim (не bookworm-slim)', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun x',
        'FROM mirror.gcr.io/library/debian:bookworm',
        'COPY --from=build-env /x /x'
      ].join('\n')
    )
    expect(h).toContain('дозволеним runtime-образом')
  })

  test('fail: single stage', () => {
    const h = getMultistageAndRuntimeHint(['FROM mirror.gcr.io/oven/bun:alpine', 'RUN bun run start'].join('\n'))
    expect(h).toContain('мінімум 2 інструкції FROM')
  })

  test('fail: final stage is bun', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun build',
        'FROM mirror.gcr.io/oven/bun:alpine',
        'CMD ["bun","./app"]'
      ].join('\n')
    )
    expect(h).toContain('дозволеним runtime-образом')
    expect(h).toContain('oven/bun')
  })
})
