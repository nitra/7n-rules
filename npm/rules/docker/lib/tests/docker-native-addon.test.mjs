/**
 * Тести docker-native-addon: детект нативних .node-аддонів у deps і антипатерн
 * «нативний аддон + `bun build --compile`» (sharp не трейситься компілятором).
 */
import { describe, expect, test } from 'vitest'

import {
  NATIVE_ADDON_PACKAGES,
  NATIVE_ADDON_SCOPES,
  isNativeAddonPackage,
  getNativeAddonDeps,
  getNativeAddonNoCompileHint
} from '../docker-native-addon.mjs'

describe('NATIVE_ADDON_* константи', () => {
  test('sharp / argon2 у списку пакетів, @img/ у scope', () => {
    expect(NATIVE_ADDON_PACKAGES).toContain('sharp')
    expect(NATIVE_ADDON_PACKAGES).toContain('argon2')
    expect(NATIVE_ADDON_SCOPES).toContain('@img/')
  })
})

describe('isNativeAddonPackage', () => {
  test('точні імена', () => {
    expect(isNativeAddonPackage('sharp')).toBe(true)
    expect(isNativeAddonPackage('argon2')).toBe(true)
  })

  test('scope-префікс @img/*', () => {
    expect(isNativeAddonPackage('@img/sharp-linuxmusl-arm64')).toBe(true)
  })

  test('звичайний пакет — ні', () => {
    expect(isNativeAddonPackage('express')).toBe(false)
    expect(isNativeAddonPackage('sharpen')).toBe(false)
  })
})

describe('getNativeAddonDeps', () => {
  test('повертає відсортовані знайдені аддони', () => {
    expect(getNativeAddonDeps({ sharp: '^0.34.5', express: '^4', '@img/sharp-darwin-arm64': '1' })).toEqual([
      '@img/sharp-darwin-arm64',
      'sharp'
    ])
  })

  test('немає аддонів → []', () => {
    expect(getNativeAddonDeps({ express: '^4', pino: '^9' })).toEqual([])
  })

  test('невалідний вхід → []', () => {
    expect(getNativeAddonDeps(null)).toEqual([])
    expect(getNativeAddonDeps(['sharp'])).toEqual([])
    expect(getNativeAddonDeps('sharp')).toEqual([])
  })
})

describe('getNativeAddonNoCompileHint', () => {
  const COMPILE_DOCKERFILE = [
    'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
    'RUN bun install --production',
    'RUN bun build --compile --outfile app ./src/index.js',
    'FROM mirror.gcr.io/library/alpine:latest',
    'RUN apk add --no-cache libstdc++ libgcc vips tzdata',
    'COPY --from=build-env --chown=app:app /app/app ./app',
    'USER app',
    'CMD ["./app"]'
  ].join('\n')

  test('fail: нативний аддон + bun build --compile', () => {
    const h = getNativeAddonNoCompileHint(COMPILE_DOCKERFILE, ['sharp'])
    expect(h).toContain('нативного .node-аддона (sharp)')
    expect(h).toContain('bun <entry>')
    expect(h).toContain('mirror.gcr.io/oven/bun:alpine')
  })

  test('fail: додатково прапорцює зайвий apk add vips', () => {
    const h = getNativeAddonNoCompileHint(COMPILE_DOCKERFILE, ['sharp'])
    expect(h).toContain('vips')
    expect(h).toContain('sharp.node')
  })

  test('ok: нативний аддон, але без compile (канон) → null', () => {
    const canon = [
      'FROM mirror.gcr.io/oven/bun:alpine AS build-env',
      'RUN bun install --production',
      'FROM mirror.gcr.io/oven/bun:alpine',
      'COPY --from=build-env --chown=bun:bun /app/node_modules ./node_modules',
      'USER bun',
      'CMD ["bun", "src/index.js"]'
    ].join('\n')
    expect(getNativeAddonNoCompileHint(canon, ['sharp'])).toBe(null)
  })

  test('skip: немає нативних аддонів → null навіть із compile', () => {
    expect(getNativeAddonNoCompileHint(COMPILE_DOCKERFILE, [])).toBe(null)
  })

  test('без apk vips — hint без vips-пункту', () => {
    const noVips = [
      'RUN bun build --compile --outfile app ./src/index.js',
      'FROM mirror.gcr.io/library/alpine:latest',
      'CMD ["./app"]'
    ].join('\n')
    const h = getNativeAddonNoCompileHint(noVips, ['sharp'])
    expect(h).toContain('нативного .node-аддона')
    expect(h).not.toContain('vips')
  })
})
