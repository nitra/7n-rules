import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'

import { syncSetupBunDepsAction } from '../scripts/sync-setup-bun-deps-action.mjs'

const npmPackageRoot = join(import.meta.dirname, '..')

describe('syncSetupBunDepsAction', () => {
  test('копіює action.yml у тимчасовий корінь', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nitra-cursor-setup-bun-'))
    try {
      const { destPath, written } = await syncSetupBunDepsAction(dir, npmPackageRoot)
      expect(written).toBe(true)
      expect(destPath).toBe(join(dir, '.github', 'actions', 'setup-bun-deps', 'action.yml'))
      const text = await readFile(destPath, 'utf8')
      expect(text).toContain('Setup Bun dependencies')
      expect(text).toContain('bun install --frozen-lockfile')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
