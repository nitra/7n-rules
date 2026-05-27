import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { applies } from '../applies.mjs'

/** @returns {string} абсолютний шлях тимчасового кореня */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-applies-'))
}

describe('rust applies', () => {
  test('true коли Cargo.toml у cwd', async () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="x"\n')
      expect(await applies(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('true коли Cargo.toml у src-tauri/', async () => {
    const root = makeRoot()
    try {
      mkdirSync(join(root, 'src-tauri'))
      writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n')
      expect(await applies(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('false коли немає Cargo.toml', async () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'package.json'), '{}')
      expect(await applies(root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
