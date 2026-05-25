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
  removeOrphanPiExtension,
  syncClaudeConfig,
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

describe('removeOrphanPiExtension', () => {
  test('видаляє .pi/extensions/n-cursor-adr/ якщо існує', async () => {
    await withTmpCwd(async cwd => {
      const extDir = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
      await mkdir(extDir, { recursive: true })
      await writeFile(join(extDir, 'index.ts'), '// stale\n', 'utf8')
      const result = await removeOrphanPiExtension(cwd)
      expect(result.removed).toBe(true)
      expect(result.path).toBe(`${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}`)
      expect(existsSync(extDir)).toBe(false)
    })
  })

  test('no-op якщо директорії немає', async () => {
    await withTmpCwd(async cwd => {
      const result = await removeOrphanPiExtension(cwd)
      expect(result.removed).toBe(false)
      expect(result.path).toBe('')
    })
  })

  test('не чіпає інші extensions у .pi/extensions/', async () => {
    await withTmpCwd(async cwd => {
      const ours = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
      const userOwn = join(cwd, PI_EXTENSIONS_DIR, 'user-custom')
      await mkdir(ours, { recursive: true })
      await mkdir(userOwn, { recursive: true })
      await writeFile(join(ours, 'index.ts'), '', 'utf8')
      await writeFile(join(userOwn, 'index.ts'), '// user\n', 'utf8')
      await removeOrphanPiExtension(cwd)
      expect(existsSync(ours)).toBe(false)
      expect(existsSync(userOwn)).toBe(true)
    })
  })
})

/**
 * Створює мінімальний bundled-пакет із .claude-template і .pi-template одночасно.
 * @param {string} cwdAbs корінь тимчасового проєкту
 * @returns {Promise<string>} абсолютний шлях до bundledPackageRoot (`<cwd>/pkg`)
 */
async function setupFullTemplate(cwdAbs) {
  const pkgRoot = await setupPiTemplate(cwdAbs)
  await mkdir(join(pkgRoot, '.claude-template', 'hooks'), { recursive: true })
  await mkdir(join(pkgRoot, '.claude-template', 'commands'), { recursive: true })
  await writeFile(join(pkgRoot, '.claude-template', 'settings.template.json'), '{}', 'utf8')
  await writeFile(
    join(pkgRoot, '.claude-template', 'hooks', 'capture-decisions.sh'),
    '#!/usr/bin/env bash\n',
    'utf8'
  )
  await writeFile(
    join(pkgRoot, '.claude-template', 'hooks', 'normalize-decisions.sh'),
    '#!/usr/bin/env bash\n',
    'utf8'
  )
  return pkgRoot
}

describe('syncClaudeConfig + pi extension gating', () => {
  test('коли adr ∈ rules — створює .pi/extensions/n-cursor-adr/index.ts', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupFullTemplate(cwd)
      const result = await syncClaudeConfig({
        projectRoot: cwd,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr']
      })
      expect(result.piExtension).toBe(true)
      expect(existsSync(join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts'))).toBe(true)
    })
  })

  test('коли adr ∉ rules — видаляє існуючий .pi/extensions/n-cursor-adr/', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupFullTemplate(cwd)
      const existing = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
      await mkdir(existing, { recursive: true })
      await writeFile(join(existing, 'index.ts'), '// stale\n', 'utf8')

      const result = await syncClaudeConfig({
        projectRoot: cwd,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: []
      })
      expect(result.piExtension).toBe(false)
      expect(existsSync(existing)).toBe(false)
    })
  })

  test('коли claude-config: false — pi extension не створюється', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupFullTemplate(cwd)
      const result = await syncClaudeConfig({
        projectRoot: cwd,
        bundledPackageRoot: pkgRoot,
        enabled: false,
        rules: ['adr']
      })
      expect(result.piExtension).toBe(false)
      expect(existsSync(join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts'))).toBe(false)
    })
  })
})
