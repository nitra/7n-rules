import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { hasCargoTomlInTree } from '../has-cargo-toml.mjs'

const IGNORED_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])

/** @returns {string} абсолютний шлях до тимчасового кореня */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-has-cargo-'))
}

describe('hasCargoTomlInTree', () => {
  test('повертає true при наявності Cargo.toml у корені', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="x"\n')
    try {
      expect(hasCargoTomlInTree(root, IGNORED_NAMES)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('повертає true при Cargo.toml у workspace-підкаталозі', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'src-tauri'), { recursive: true })
    writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n')
    try {
      expect(hasCargoTomlInTree(root, IGNORED_NAMES)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('повертає false при відсутності Cargo.toml', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'package.json'), '{}')
    try {
      expect(hasCargoTomlInTree(root, IGNORED_NAMES)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ігнорує Cargo.toml у node_modules/', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'Cargo.toml'), '')
    try {
      expect(hasCargoTomlInTree(root, IGNORED_NAMES)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
