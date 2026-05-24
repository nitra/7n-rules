import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { applies } from '../applies.mjs'

/** @returns {string} абсолютний шлях тимчасового кореня */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-applies-'))
}

describe('rust applies', () => {
  test('true коли Cargo.toml у cwd', async () => {
    const root = makeRoot()
    const orig = process.cwd()
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="x"\n')
    process.chdir(root)
    try {
      expect(await applies()).toBe(true)
    } finally {
      process.chdir(orig)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('true коли Cargo.toml у src-tauri/', async () => {
    const root = makeRoot()
    const orig = process.cwd()
    mkdirSync(join(root, 'src-tauri'))
    writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n')
    process.chdir(root)
    try {
      expect(await applies()).toBe(true)
    } finally {
      process.chdir(orig)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('false коли немає Cargo.toml', async () => {
    const root = makeRoot()
    const orig = process.cwd()
    writeFileSync(join(root, 'package.json'), '{}')
    process.chdir(root)
    try {
      expect(await applies()).toBe(false)
    } finally {
      process.chdir(orig)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
