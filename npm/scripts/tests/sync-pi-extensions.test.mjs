/**
 * Тести pi.dev-extension синку: bundled TS-template у `.pi-template/extensions/n-cursor-adr/`,
 * `syncPiExtensions` (copy), `removeOrphanPiExtension` (cleanup), інтеграція у `syncClaudeConfig`.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  PI_EXTENSIONS_DIR,
  PI_EXTENSION_NAME,
  PI_TEMPLATE_DIR_NAME,
  syncPiExtensions
} from '../sync-claude-config.mjs'
import { withTmpCwd } from '../utils/test-helpers.mjs'

const PI_TEMPLATE_PATH = join(import.meta.dir, '..', '..', '.pi-template', 'extensions', 'n-cursor-adr', 'index.ts')

/**
 * Створює мінімальний bundled-пакет із `.pi-template/extensions/n-cursor-adr/index.ts`.
 * @param {string} cwdAbs корінь тимчасового проєкту
 * @returns {Promise<string>} абсолютний шлях до bundledPackageRoot
 */
async function setupPiTemplate(cwdAbs) {
  const pkgRoot = join(cwdAbs, 'pkg')
  const extDir = join(pkgRoot, PI_TEMPLATE_DIR_NAME, 'extensions', PI_EXTENSION_NAME)
  await mkdir(extDir, { recursive: true })
  await writeFile(
    join(extDir, 'index.ts'),
    '// bundled pi extension stub\nexport default function (pi) {}\n',
    'utf8'
  )
  return pkgRoot
}

describe('.pi-template/extensions/n-cursor-adr/index.ts (bundled)', () => {
  test('файл існує у пакеті', () => {
    expect(existsSync(PI_TEMPLATE_PATH)).toBe(true)
  })

  test('має default export factory function', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/export default function/)
    expect(src).toMatch(/pi\.on\(['"]agent_end['"]/)
  })

  test('спавнить обидва bash-скрипти capture/normalize', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/capture-decisions\.sh/)
    expect(src).toMatch(/normalize-decisions\.sh/)
  })

  test('виставляє CLAUDE_PROJECT_DIR у env', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/CLAUDE_PROJECT_DIR/)
  })

  test('має recursion guard через CAPTURE_DECISIONS_RUNNING / ADR_NORMALIZE_RUNNING', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/CAPTURE_DECISIONS_RUNNING/)
    expect(src).toMatch(/ADR_NORMALIZE_RUNNING/)
  })
})

describe('syncPiExtensions', () => {
  test('копіює bundled extension у .pi/extensions/<name>/index.ts', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      const result = await syncPiExtensions(cwd, pkgRoot)
      expect(result.written).toBe(true)
      expect(result.path).toBe(`${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}/index.ts`)
      const dest = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts')
      const content = await readFile(dest, 'utf8')
      expect(content).toContain('bundled pi extension stub')
    })
  })

  test('повертає {written:false} якщо bundled template відсутній', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = join(cwd, 'empty-pkg')
      await mkdir(pkgRoot, { recursive: true })
      const result = await syncPiExtensions(cwd, pkgRoot)
      expect(result.written).toBe(false)
      expect(result.path).toBe('')
    })
  })

  test('перезаписує існуючий index.ts (fully-owned)', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      await mkdir(join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME), { recursive: true })
      await writeFile(
        join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts'),
        '// stale content\n',
        'utf8'
      )
      await syncPiExtensions(cwd, pkgRoot)
      const content = await readFile(
        join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts'),
        'utf8'
      )
      expect(content).toContain('bundled pi extension stub')
      expect(content).not.toContain('stale content')
    })
  })
})
