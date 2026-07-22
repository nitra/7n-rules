import { describe, expect, test } from 'vitest'

import { assertCoverageProvider, assertEcosystemProvider, isBreaking, parseVersion } from '../plugin-api.mjs'

const NOOP = () => null
const MISSING_COLLECT_RE = /collect, collectPerFile/
const MISSING_ID_RE = /id/
const MISSING_CLEANUP_RE = /cleanup/

describe('parseVersion', () => {
  test('range-префікси ігноруються', () => {
    expect(parseVersion('^1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('>=0.5.0')).toEqual({ major: 0, minor: 5, patch: 0 })
  })

  test('не-semver → null', () => {
    expect(parseVersion('workspace:*')).toBeNull()
    expect(parseVersion(42)).toBeNull()
  })
})

describe('isBreaking (caret-семантика)', () => {
  test('major/0.minor/0.0.patch переходи', () => {
    expect(isBreaking({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 })).toBe(true)
    expect(isBreaking({ major: 1, minor: 1, patch: 0 }, { major: 1, minor: 2, patch: 0 })).toBe(false)
    expect(isBreaking({ major: 0, minor: 1, patch: 0 }, { major: 0, minor: 2, patch: 0 })).toBe(true)
    expect(isBreaking({ major: 0, minor: 0, patch: 1 }, { major: 0, minor: 0, patch: 2 })).toBe(true)
  })
})

describe('assertCoverageProvider', () => {
  const valid = { id: 'js', title: 'JS', detect: NOOP, collect: NOOP, collectPerFile: NOOP }

  test('валідний провайдер повертається як є', () => {
    expect(assertCoverageProvider(valid, 'lang-js')).toBe(valid)
  })

  test('не-обʼєкт → TypeError', () => {
    expect(() => assertCoverageProvider(null, 'lang-js')).toThrow(TypeError)
  })

  test('відсутні поля перелічуються в помилці', () => {
    expect(() => assertCoverageProvider({ id: 'js', title: 'JS', detect: NOOP }, 'lang-js')).toThrow(MISSING_COLLECT_RE)
    expect(() => assertCoverageProvider({ ...valid, id: '' }, 'lang-js')).toThrow(MISSING_ID_RE)
  })
})

describe('assertEcosystemProvider', () => {
  const valid = {
    id: 'js-bun',
    title: 'npm-пакети',
    manifestNoun: 'package.json',
    skillSection: 'JS-гілкою SKILL.md',
    detect: NOOP,
    available: NOOP,
    backup: NOOP,
    bump: NOOP,
    diff: NOOP,
    promptFor: NOOP,
    cleanup: NOOP
  }

  test('валідний провайдер повертається як є', () => {
    expect(assertEcosystemProvider(valid, 'lang-js')).toBe(valid)
  })

  test('відсутня функція → TypeError з іменем поля', () => {
    const { cleanup: _cleanup, ...broken } = valid
    expect(() => assertEcosystemProvider(broken, 'lang-js')).toThrow(MISSING_CLEANUP_RE)
  })
})
