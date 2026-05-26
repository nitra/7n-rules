/**
 * Тести вимоги тега `alpine-slim` для `mirror.gcr.io/nginxinc/nginx-unprivileged` (docker.mdc: мінімальні образи).
 *
 * `library/nginx` тут не перевіряється — правило `docker.mdc` (frontend-розділ і «Мінімальні образи») забороняє цей образ
 * повністю (треба `nginxinc/nginx-unprivileged`); сам факт `FROM library/nginx:*` рубає `getMultistageAndRuntimeHint`.
 */
import { describe, expect, test } from 'vitest'

import { getNginxAlpineSlimTagHint } from '../../../lint.mjs'

describe('getNginxAlpineSlimTagHint', () => {
  test('ok: nginx-unprivileged з тегом alpine-slim', () => {
    expect(
      getNginxAlpineSlimTagHint(
        [
          'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
          'FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim'
        ].join('\n')
      )
    ).toBe(null)
  })

  test('ok: тег з іншим регістром (nginx-unprivileged)', () => {
    expect(getNginxAlpineSlimTagHint('FROM mirror.gcr.io/nginxinc/nginx-unprivileged:Alpine-Slim\n')).toBe(null)
  })

  test('ok: схожий за іменем образ (library/nginx2) — не чіпаємо', () => {
    expect(getNginxAlpineSlimTagHint('FROM mirror.gcr.io/library/nginx2:latest\n')).toBe(null)
  })

  test('fail: nginx-unprivileged latest замість alpine-slim', () => {
    const h = getNginxAlpineSlimTagHint('FROM mirror.gcr.io/nginxinc/nginx-unprivileged:latest\n')
    expect(h).toContain('alpine-slim')
    expect(h).toContain('latest')
  })

  test('fail: nginx-unprivileged без тега', () => {
    const h = getNginxAlpineSlimTagHint('FROM mirror.gcr.io/nginxinc/nginx-unprivileged\n')
    expect(h).toContain('без тега')
  })
})
