/**
 * Тести вимоги multistage build і мінімального runtime stage (alpine/nginx).
 */
import { describe, expect, test } from 'bun:test'

import { getMultistageAndRuntimeHint, parseFromStages } from '../scripts/check-docker.mjs'

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

  test('ok: multistage + final nginx', () => {
    const h = getMultistageAndRuntimeHint(
      [
        'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
        'RUN bun x',
        'FROM mirror.gcr.io/library/nginx:alpine',
        'COPY --from=build-env /app/dist /usr/share/nginx/html'
      ].join('\n')
    )
    expect(h).toBe(null)
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
    expect(h).toContain('фінальний FROM має бути')
    expect(h).toContain('mirror.gcr.io/library/alpine')
  })
})
