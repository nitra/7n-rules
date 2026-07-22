/**
 * Тести T0-codemod `fix-check.mjs` (rust). Реальний `cargo fmt` зав'язаний на cargo-проєкт
 * (перевірено e2e); тут — контракт патерну: test-предикат.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'

import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-check.mjs'

const P = patterns[0]
const DENY = patterns[1]

describe('rust-cargo-fmt pattern', () => {
  test('id', () => {
    expect(patterns).toHaveLength(2)
    expect(P.id).toBe('rust-cargo-fmt')
  })

  test('test: true на cargo-fmt-violation', () => {
    expect(P.test([{ reason: 'cargo-fmt-violation', message: 'm' }])).toBe(true)
  })

  test('test: false на clippy/інших (clippy не автофіксимо)', () => {
    expect(P.test([{ reason: 'cargo-clippy-violation', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })
})

describe('rust-cargo-deny-init pattern', () => {
  test('id', () => {
    expect(DENY.id).toBe('rust-cargo-deny-init')
  })

  test('test: true на deny-config-missing', () => {
    expect(DENY.test([{ reason: 'deny-config-missing', message: 'm' }])).toBe(true)
  })

  test('test: false на clippy/інших', () => {
    expect(DENY.test([{ reason: 'cargo-clippy-violation', message: 'm' }])).toBe(false)
    expect(DENY.test([])).toBe(false)
  })

  test('apply: без cargo/cargo-deny у PATH — пише мінімальний валідний скаффолд (без [deny])', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'rust-check-deny-fallback-'))
    const isolatedPathDir = await mkdtemp(join(tmpdir(), 'rust-check-empty-path-'))
    const prevPath = env.PATH
    env.PATH = isolatedPathDir
    try {
      const result = await DENY.apply([{ reason: 'deny-config-missing', message: 'm' }], {
        cwd,
        recordWrite: () => {}
      })
      expect(result.touchedFiles).toHaveLength(1)

      const content = await readFile(join(cwd, 'deny.toml'), 'utf8')
      // Схема cargo-deny НЕ має секції [deny] — саме її галюцинував LLM-fix до цього патерну.
      expect(content).not.toContain('[deny]')
      expect(content).toContain('[advisories]')
      expect(content).toContain('[licenses]')
      expect(content).toContain('[bans]')
      expect(content).toContain('[sources]')
    } finally {
      env.PATH = prevPath
      await rm(cwd, { recursive: true, force: true })
      await rm(isolatedPathDir, { recursive: true, force: true })
    }
  })
})
