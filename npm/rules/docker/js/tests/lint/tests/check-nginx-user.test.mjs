/**
 * Тести правила non-root для фінального stage на базі `nginxinc/nginx-unprivileged`:
 * жодних `USER root`/switch-back, `COPY`/`ADD` лише з `--chown` (docker.mdc: не превілейований образ).
 */
import { describe, expect, test } from 'vitest'

import { getNginxUnprivilegedUserHint, isNginxUnprivilegedImage } from '../../../../lib/docker-nginx-user.mjs'

const CANON = [
  'FROM mirror.gcr.io/oven/bun:alpine AS build',
  'WORKDIR /app',
  'COPY . ./',
  'RUN bun install && bun vite build --mode prod --base=/',
  'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
  'COPY --chown=nginx:nginx ./k8s/nginx.conf /etc/nginx/conf.d/default.conf',
  'WORKDIR /usr/share/nginx/html',
  'COPY --from=build --chown=nginx:nginx /app/dist ./',
  String.raw`RUN find ./ -type f -name "*.js" -exec gzip -k {} \;`
].join('\n')

const ANTIPATTERN = [
  'FROM mirror.gcr.io/oven/bun:alpine AS build',
  'RUN bun install && bun vite build',
  'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
  'USER root',
  'COPY ./k8s/nginx.conf /etc/nginx/conf.d/default.conf',
  'COPY --from=build /app/dist ./',
  String.raw`RUN find ./ -type f -name "*.js" -exec gzip -k {} \;`,
  'USER 101',
  'EXPOSE 8080'
].join('\n')

describe('isNginxUnprivilegedImage', () => {
  test('mirror.gcr.io + tag', () => {
    expect(isNginxUnprivilegedImage('mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim')).toBe(true)
  })

  test('bare repo + tag (без mirror-префікса)', () => {
    expect(isNginxUnprivilegedImage('nginxinc/nginx-unprivileged:latest')).toBe(true)
  })

  test('без тега', () => {
    expect(isNginxUnprivilegedImage('mirror.gcr.io/nginxinc/nginx-unprivileged')).toBe(true)
  })

  test('digest', () => {
    expect(isNginxUnprivilegedImage('mirror.gcr.io/nginxinc/nginx-unprivileged@sha256:abc')).toBe(true)
  })

  test('схожий за іменем образ — не плутаємо', () => {
    expect(isNginxUnprivilegedImage('mycustomnginxinc/nginx-unprivileged:latest')).toBe(false)
    expect(isNginxUnprivilegedImage('mirror.gcr.io/library/nginx:alpine-slim')).toBe(false)
  })
})

describe('getNginxUnprivilegedUserHint', () => {
  test('ok: канон — без USER, з --chown', () => {
    expect(getNginxUnprivilegedUserHint(CANON)).toBe(null)
  })

  test('ok: фінальний stage не nginx (alpine) — правило не застосовне', () => {
    const h = getNginxUnprivilegedUserHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build',
        'FROM mirror.gcr.io/library/alpine:latest',
        'USER root',
        'COPY a b'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('fail: антипатерн — USER root, switch-back USER 101, COPY без --chown', () => {
    const h = getNginxUnprivilegedUserHint(ANTIPATTERN)
    expect(h).toContain('USER root')
    expect(h).toContain('USER 101')
    expect(h).toContain('--chown=nginx:nginx')
    // обидва COPY без --chown прапорцюються (по одному пункту на рядок)
    expect(h).toContain('COPY')
    expect(h.split('\n')).toHaveLength(4)
  })

  test('fail: USER 0 як перемикання на root', () => {
    const h = getNginxUnprivilegedUserHint(
      ['FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim', 'USER 0', 'COPY --chown=nginx:nginx a b'].join(
        '\n'
      )
    )
    expect(h).toContain('USER 0')
    expect(h).toContain('root')
  })

  test('fail: switch-back на USER nginx (за іменем) — теж зайвий', () => {
    const h = getNginxUnprivilegedUserHint(
      [
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'USER root',
        'COPY --chown=nginx:nginx a b',
        'USER nginx'
      ].join('\n')
    )
    expect(h).toContain('USER root')
    expect(h).toContain('USER nginx')
  })

  test('fail: будь-який інший явний USER (appuser) теж зайвий', () => {
    const h = getNginxUnprivilegedUserHint(
      [
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'USER appuser',
        'COPY --chown=nginx:nginx a b'
      ].join('\n')
    )
    expect(h).toContain('USER appuser')
    expect(h).toContain('non-root')
  })

  test('fail: USER у лапках ("root") нормалізується', () => {
    const h = getNginxUnprivilegedUserHint(
      [
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'USER "root"',
        'COPY --chown=nginx:nginx a b'
      ].join('\n')
    )
    expect(h).toContain('root')
  })

  test('fail: ADD без --chown', () => {
    const h = getNginxUnprivilegedUserHint(
      ['FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim', 'ADD ./site.tar /usr/share/nginx/html'].join('\n')
    )
    expect(h).toContain('ADD')
    expect(h).toContain('--chown=nginx:nginx')
  })

  test('ok: build-stage із USER root не чіпаємо (фінальний — nginx, чистий)', () => {
    const h = getNginxUnprivilegedUserHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build',
        'USER root',
        'RUN bun install',
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'COPY --from=build --chown=nginx:nginx /app/dist ./'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('ok: COPY --from=build --chown=101:101 (числовий UID теж валідний)', () => {
    const h = getNginxUnprivilegedUserHint(
      [
        'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim',
        'COPY --from=build --chown=101:101 /app/dist ./'
      ].join('\n')
    )
    expect(h).toBe(null)
  })

  test('ok: немає FROM — null', () => {
    expect(getNginxUnprivilegedUserHint('RUN echo hi')).toBe(null)
  })
})
