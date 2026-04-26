/**
 * Тести вимоги тега `alpine-slim` для `mirror.gcr.io/library/nginx` (docker.mdc: мінімальні образи).
 */
import { describe, expect, test } from 'bun:test'

import { getNginxAlpineSlimTagHint } from '../scripts/check-docker.mjs'

describe('getNginxAlpineSlimTagHint', () => {
  test('ok: nginx з тегом alpine-slim', () => {
    expect(
      getNginxAlpineSlimTagHint(
        ['FROM mirror.gcr.io/oven/bun:alpine AS a', 'FROM mirror.gcr.io/library/nginx:alpine-slim'].join('\n')
      )
    ).toBe(null)
  })

  test('ok: тег з іншим регістром', () => {
    expect(getNginxAlpineSlimTagHint('FROM mirror.gcr.io/library/nginx:Alpine-Slim\n')).toBe(null)
  })

  test('ok: інший образ (library/nginx2) — не чіпаємо', () => {
    expect(
      getNginxAlpineSlimTagHint('FROM mirror.gcr.io/library/nginx2:latest\n')
    ).toBe(null)
  })

  test('fail: latest замість alpine-slim', () => {
    const h = getNginxAlpineSlimTagHint('FROM mirror.gcr.io/library/nginx:latest\n')
    expect(h).toContain('alpine-slim')
    expect(h).toContain('latest')
  })

  test('fail: без тега', () => {
    const h = getNginxAlpineSlimTagHint('FROM mirror.gcr.io/library/nginx\n')
    expect(h).toContain('без тега')
  })

  test('fail: alpine (не slim)', () => {
    const h = getNginxAlpineSlimTagHint('FROM mirror.gcr.io/library/nginx:alpine\n')
    expect(h).toContain('alpine-slim')
  })
})
