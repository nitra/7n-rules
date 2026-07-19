/**
 * Тести для taze/provider.mjs:
 *   - форма EcosystemProvider (валідна за assertEcosystemProvider ядра);
 *   - buildDependencyPrompt: промпт містить пакет/версії, лише кроки 4-6;
 *   - backupWorkspacePackageFiles/cleanupWorkspaceBackups: реальні tmp-файли;
 *   - bump: bunx taze + bun install, throw на провалі;
 *   - diff: мапінг workspace → manifest (контракт порту);
 *   - available: graceful skip без bun.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { assertEcosystemProvider } from '@7n/rules/plugin-api'
import { ensureDir, withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import jsProvider, {
  backupWorkspacePackageFiles,
  buildDependencyPrompt,
  cleanupWorkspaceBackups
} from '../provider.mjs'

const BUNX_EXIT_RE = /bunx taze -w -r latest → exit 1/

/** Заглушка `log` для тестів, де вивід не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід */
}

describe('jsProvider (форма контракту)', () => {
  test('валідний EcosystemProvider за assertEcosystemProvider ядра', () => {
    expect(assertEcosystemProvider(jsProvider, '@7n/rules-lang-js')).toBe(jsProvider)
    expect(jsProvider.id).toBe('js-bun')
    expect(jsProvider.manifestNoun).toBe('package.json')
  })

  test('detect: кореневий package.json → один маніфест; без нього — тиша', async () => {
    await withTmpDir(async dir => {
      expect(jsProvider.detect(dir, {})).toEqual([])
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      expect(jsProvider.detect(dir, {})).toEqual(['package.json'])
    })
  })

  test('available: bun відсутній → ok:false з причиною', () => {
    const availability = jsProvider.available(() => ({ status: 1, stdout: '', stderr: 'not found' }))
    expect(availability.ok).toBe(false)
    expect(availability.reason).toContain('bun')
  })

  test('bump: bunx taze -w -r latest + bun install', async () => {
    const calls = []
    await jsProvider.bump('/tmp/project', ['package.json'], {
      spawnFn: (cmd, args) => {
        calls.push([cmd, ...args])
        return { status: 0, stdout: '', stderr: '' }
      },
      log: noop
    })
    expect(calls).toEqual([
      ['bunx', 'taze', '-w', '-r', 'latest'],
      ['bun', 'install']
    ])
  })

  test('bump: провал команди → кидає з exit-кодом+stderr', () => {
    expect(() =>
      jsProvider.bump('/tmp/project', ['package.json'], {
        spawnFn: () => ({ status: 1, stdout: '', stderr: 'network error' }),
        log: noop
      })
    ).toThrow(BUNX_EXIT_RE)
  })

  test('diff: workspace-записи мапляться на manifest (контракт порту)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'utf8')
      await writeFile(
        join(dir, 'package.json.taze-bak'),
        JSON.stringify({ dependencies: { react: '^17.0.0' } }),
        'utf8'
      )
      const diff = await jsProvider.diff(dir)
      expect(diff.major).toEqual([{ manifest: '.', pkg: 'react', from: '^17.0.0', to: '^18.0.0' }])
    })
  })
})

describe('buildDependencyPrompt', () => {
  test('містить пакет, воркспейс і версії; без кроків 1-3', () => {
    const prompt = buildDependencyPrompt({ manifest: 'npm', pkg: 'react', from: '^17.0.0', to: '^18.0.0' })
    expect(prompt).toContain('react')
    expect(prompt).toContain('^17.0.0 → ^18.0.0')
    expect(prompt).toContain('breaking changes')
    expect(prompt).not.toContain('bunx taze')
  })
})

describe('backupWorkspacePackageFiles + cleanupWorkspaceBackups', () => {
  test('бекапить package.json кожного воркспейсу і прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      await ensureDir(join(dir, 'pkg-a'))
      await writeFile(join(dir, 'pkg-a/package.json'), '{}', 'utf8')

      const workspaces = await backupWorkspacePackageFiles(dir, {
        getMonorepoPackageRootDirs: () => ['.', 'pkg-a']
      })
      expect(workspaces).toEqual(['.', 'pkg-a'])
      expect(existsSync(join(dir, 'package.json.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'pkg-a/package.json.taze-bak'))).toBe(true)

      await cleanupWorkspaceBackups(dir, { getMonorepoPackageRootDirs: () => ['.', 'pkg-a'] })
      expect(existsSync(join(dir, 'package.json.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'pkg-a/package.json.taze-bak'))).toBe(false)
    })
  })
})
