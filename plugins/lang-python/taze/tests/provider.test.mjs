/**
 * Тести для taze/provider.mjs:
 *   - форма EcosystemProvider (валідна за assertEcosystemProvider ядра);
 *   - buildUvDependencyPrompt: промпт містить пакет/версії, без чужих команд;
 *   - findPyprojectManifest/backupUvManifest/cleanupUvBackups: реальні tmp-файли;
 *   - bumpUvDependencies: цикл uv remove + uv add --bounds lower, best-effort відновлення;
 *   - available: graceful skip без uv.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { assertEcosystemProvider } from '@7n/rules/plugin-api'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import pythonProvider, {
  backupUvManifest,
  buildUvDependencyPrompt,
  bumpUvDependencies,
  cleanupUvBackups,
  findPyprojectManifest
} from '../provider.mjs'

/** Заглушка `log` для тестів, де вивід не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід */
}

describe('pythonProvider (форма контракту)', () => {
  test('валідний EcosystemProvider за assertEcosystemProvider ядра', () => {
    expect(assertEcosystemProvider(pythonProvider, '@7n/rules-lang-python')).toBe(pythonProvider)
    expect(pythonProvider.id).toBe('python-uv')
    expect(pythonProvider.manifestNoun).toBe('pyproject.toml')
  })

  test('available: uv відсутній → ok:false з причиною', () => {
    const availability = pythonProvider.available(() => ({ status: 1, stdout: '', stderr: 'not found' }))
    expect(availability.ok).toBe(false)
    expect(availability.reason).toContain('uv')
  })

  test('available: uv є → ok:true', () => {
    expect(pythonProvider.available(() => ({ status: 0, stdout: 'uv 0.11.23', stderr: '' }))).toEqual({
      ok: true,
      reason: null
    })
  })
})

describe('buildUvDependencyPrompt', () => {
  test('містить пакет, маніфест і версії', () => {
    const prompt = buildUvDependencyPrompt({
      manifest: 'pyproject.toml',
      pkg: 'typer',
      from: '0.19.1',
      to: '0.27.0'
    })
    expect(prompt).toContain('typer')
    expect(prompt).toContain('pyproject.toml')
    expect(prompt).toContain('0.19.1 → 0.27.0')
    expect(prompt).toContain('pypi.org')
    expect(prompt).toContain('rg -n --type py')
  })

  test('не змішує з Rust/npm-командами інших гілок', () => {
    const prompt = buildUvDependencyPrompt({ manifest: 'pyproject.toml', pkg: 'httpx', from: '0.27.0', to: '1.0.0' })
    expect(prompt).not.toContain('cargo')
    expect(prompt).not.toContain('bunx taze')
  })
})

describe('findPyprojectManifest', () => {
  test('pyproject.toml існує → список з одним записом', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]', 'utf8')
      expect(findPyprojectManifest(dir)).toEqual(['pyproject.toml'])
    })
  })

  test('pyproject.toml відсутній → порожній список', async () => {
    await withTmpDir(dir => {
      expect(findPyprojectManifest(dir)).toEqual([])
      return Promise.resolve()
    })
  })
})

describe('backupUvManifest + cleanupUvBackups', () => {
  test('бекапить pyproject.toml + uv.lock, прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]', 'utf8')
      await writeFile(join(dir, 'uv.lock'), 'version = 1', 'utf8')

      await backupUvManifest(dir)
      expect(existsSync(join(dir, 'pyproject.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'uv.lock.taze-bak'))).toBe(true)

      await cleanupUvBackups(dir)
      expect(existsSync(join(dir, 'pyproject.toml.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'uv.lock.taze-bak'))).toBe(false)
    })
  })

  test('без uv.lock — бекапить лише pyproject.toml, не падає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]', 'utf8')
      await backupUvManifest(dir)
      expect(existsSync(join(dir, 'pyproject.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'uv.lock.taze-bak'))).toBe(false)
    })
  })
})

describe('bumpUvDependencies', () => {
  test('на кожну пряму залежність: uv remove + uv add [extras] --bounds lower', async () => {
    const calls = []
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'pyproject.toml'),
        '[project]\ndependencies = ["typer>=0.19.1", "strawberry-graphql[asgi]>=0.291.0"]',
        'utf8'
      )
      await bumpUvDependencies(
        dir,
        (cmd, args) => {
          calls.push([cmd, ...args])
          return { status: 0, stdout: '', stderr: '' }
        },
        noop
      )
    })
    expect(calls).toEqual([
      ['uv', 'remove', 'typer'],
      ['uv', 'add', 'typer', '--bounds', 'lower'],
      ['uv', 'remove', 'strawberry-graphql'],
      ['uv', 'add', 'strawberry-graphql[asgi]', '--bounds', 'lower']
    ])
  })

  test('провал uv add → best-effort відновлення оригінального рядка', async () => {
    const calls = []
    const logs = []
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\ndependencies = ["typer>=0.19.1"]', 'utf8')
      await bumpUvDependencies(
        dir,
        (cmd, args) => {
          calls.push([cmd, ...args])
          const failing = args[0] === 'add' && args.includes('--bounds')
          return failing
            ? { status: 1, stdout: '', stderr: 'resolution failed' }
            : { status: 0, stdout: '', stderr: '' }
        },
        line => {
          logs.push(line)
        }
      )
    })
    expect(calls).toEqual([
      ['uv', 'remove', 'typer'],
      ['uv', 'add', 'typer', '--bounds', 'lower'],
      ['uv', 'add', 'typer>=0.19.1']
    ])
    expect(logs.some(l => l.includes('відновлюю'))).toBe(true)
  })

  test('провал uv remove → пакет пропускається, add не викликається', async () => {
    const calls = []
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\ndependencies = ["typer>=0.19.1"]', 'utf8')
      await bumpUvDependencies(
        dir,
        (cmd, args) => {
          calls.push([cmd, ...args])
          return args[0] === 'remove'
            ? { status: 1, stdout: '', stderr: 'locked' }
            : { status: 0, stdout: '', stderr: '' }
        },
        noop
      )
    })
    expect(calls).toEqual([['uv', 'remove', 'typer']])
  })
})
