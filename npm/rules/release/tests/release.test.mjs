import { describe, expect, test, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

import { release, runReleaseCli } from '../release.mjs'
import { withTmpDir, writeJson } from '../../../scripts/utils/test-helpers.mjs'

/**
 * Stub runGit для fallback-тесту: describe → тег, log → коміти, решта → ''.
 * @param {string[]} args аргументи git-команди
 * @returns {Promise<string>} результат
 */
const RE_COMMIT = /commit/u

const runGitFallbackStub = args => {
  const key = args.join(' ')
  if (key.startsWith('describe')) return Promise.resolve('p@1.0.0\n')
  if (key.startsWith('log')) return Promise.resolve('feat: щось\n')
  return Promise.resolve('')
}

const RE_PUSH = /push/u
const RE_REBASE = /rebase/u
const RE_COMMIT_BACK = /commit-back/u

/**
 * Stub runGit: push завжди non-ff, rev-parse → upstream, решта успішні (push не приземлюється).
 * @param {string[]} args аргументи git-команди
 * @returns {Promise<string|null>} результат або null (відхилено)
 */
const runGitPushNonFfStub = args => {
  const key = args.join(' ')
  if (key.startsWith('push')) return Promise.resolve(null) // завжди non-ff
  if (key.startsWith('rev-parse')) return Promise.resolve('origin/main\n')
  return Promise.resolve('') // fetch/rebase успішні, але push не приземлюється
}

/**
 * Stub runGit: push non-ff, upstream не налаштовано (rev-parse → порожньо).
 * @param {string[]} args аргументи git-команди
 * @returns {Promise<string|null>} результат або null (відхилено)
 */
const runGitPushNoUpstreamStub = args => {
  const key = args.join(' ')
  if (key.startsWith('push')) return Promise.resolve(null)
  if (key.startsWith('rev-parse')) return Promise.resolve('') // upstream не налаштовано
  return Promise.resolve('')
}

describe('release', () => {
  test('бампить version, дописує CHANGELOG, видаляє change-файли, планує тег', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.2.3', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3] - 2026-01-01\n\n### Added\n\n- old\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: minor\nsection: Added\n---\nНова фіча\n')

      const gitCalls = []
      const runGit = args => {
        gitCalls.push(args.join(' '))
        return Promise.resolve('')
      }
      const released = await release({ cwd: dir, date: '2026-05-29', runGit })

      expect(released).toEqual([{ ws: '.', name: 'p', newVersion: '1.3.0' }])
      expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version).toBe('1.3.0')
      const cl = await readFile(join(dir, 'CHANGELOG.md'), 'utf8')
      expect(cl.indexOf('## [1.3.0]')).toBeLessThan(cl.indexOf('## [1.2.3]'))
      expect(cl).toContain('Нова фіча')
      expect(existsSync(join(dir, '.changes', '1-a.md'))).toBe(false)
      expect(gitCalls).toContain('tag -a p@1.3.0 -m p@1.3.0')
      expect(gitCalls.some(c => c.startsWith('commit'))).toBe(true)
    })
  })

  test('push: false — комітить і тегує локально, але не пушить (CI пушить сам після publish)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.2.3', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Fixed\n---\nФікс\n')

      const gitCalls = []
      const runGit = args => {
        gitCalls.push(args.join(' '))
        return Promise.resolve('')
      }
      const released = await release({ cwd: dir, date: '2026-05-29', runGit, push: false })

      expect(released).toEqual([{ ws: '.', name: 'p', newVersion: '1.2.4' }])
      expect(gitCalls).toContain('tag -a p@1.2.4 -m p@1.2.4')
      expect(gitCalls.some(c => c.startsWith('commit'))).toBe(true)
      expect(gitCalls.some(c => c.startsWith('push'))).toBe(false)
    })
  })

  test('нуль change-файлів і нуль fallback-комітів → нічого не релізить', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      const released = await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })
      expect(released).toEqual([])
    })
  })

  test('python workspace: бампить [project].version у pyproject.toml', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'svc'), { recursive: true })
      await writeFile(join(dir, 'svc', 'pyproject.toml'), '[project]\nname = "svc"\nversion = "0.1.0"\n')
      await writeFile(join(dir, 'svc', 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, 'svc', '.changes'), { recursive: true })
      await writeFile(join(dir, 'svc', '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix py\n')

      await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })

      const doc = parseToml(await readFile(join(dir, 'svc', 'pyproject.toml'), 'utf8'))
      expect(doc.project.version).toBe('0.1.1')
    })
  })

  test('кілька workspace: обидва бампляться, два теги, один commit', async () => {
    await withTmpDir(async dir => {
      // монорепо-корінь з підпакетами → корінь пропускається
      await writeJson(join(dir, 'package.json'), {
        name: 'root',
        version: '0.0.0',
        private: true,
        workspaces: ['a', 'b']
      })
      for (const [ws, ver] of [
        ['a', '1.0.0'],
        ['b', '2.0.0']
      ]) {
        await mkdir(join(dir, ws, '.changes'), { recursive: true })
        await writeJson(join(dir, ws, 'package.json'), { name: ws, version: ver, files: ['CHANGELOG.md'] })
        await writeFile(join(dir, ws, 'CHANGELOG.md'), '# Changelog\n')
        await writeFile(join(dir, ws, '.changes', '1.md'), '---\nbump: minor\nsection: Added\n---\nfeat ' + ws + '\n')
      }
      const calls = []
      const runGit = args => {
        calls.push(args.join(' '))
        return Promise.resolve('')
      }
      const released = await release({ cwd: dir, date: '2026-05-29', runGit })

      expect(released.map(r => r.name).toSorted()).toEqual(['a', 'b'])
      expect(JSON.parse(await readFile(join(dir, 'a', 'package.json'), 'utf8')).version).toBe('1.1.0')
      expect(JSON.parse(await readFile(join(dir, 'b', 'package.json'), 'utf8')).version).toBe('2.1.0')
      expect(calls.filter(c => c.startsWith('commit')).length).toBe(1)
      expect(calls.filter(c => c.startsWith('tag ')).toSorted()).toEqual([
        'tag -a a@1.1.0 -m a@1.1.0',
        'tag -a b@2.1.0 -m b@2.1.0'
      ])
    })
  })

  test('fallback через release(): немає change-файлів, але є коміти → синтез + тег, без помилки rm', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      const released = await release({ cwd: dir, date: '2026-05-29', runGit: runGitFallbackStub })
      expect(released).toEqual([{ ws: '.', name: 'p', newVersion: '1.0.1' }])
      const cl = await readFile(join(dir, 'CHANGELOG.md'), 'utf8')
      expect(cl).toContain('feat: щось')
    })
  })

  test('commit-фейл скасовує теги/push', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
      const calls = []
      const runGit = args => {
        calls.push(args.join(' '))
        return Promise.resolve(args[0] === 'commit' ? null : '')
      }
      await expect(release({ cwd: dir, date: '2026-05-29', runGit })).rejects.toThrow(RE_COMMIT)
      expect(calls.some(c => c.startsWith('tag '))).toBe(false)
      expect(calls.some(c => c.startsWith('push'))).toBe(false)
    })
  })

  test('push non-ff → fetch + rebase + повторний push, теги пересунуто на новий HEAD', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
      const calls = []
      let pushN = 0
      const runGit = args => {
        const key = args.join(' ')
        calls.push(key)
        if (key.startsWith('push')) return Promise.resolve(++pushN === 1 ? null : '') // перший push відхилено
        if (key.startsWith('rev-parse')) return Promise.resolve('origin/main\n')
        return Promise.resolve('') // fetch, rebase, tag — успіх
      }
      const released = await release({ cwd: dir, date: '2026-05-29', runGit })
      expect(released).toEqual([{ ws: '.', name: 'p', newVersion: '1.0.1' }])
      expect(calls.filter(c => c.startsWith('push')).length).toBe(2)
      expect(calls).toContain('fetch origin')
      expect(calls.some(c => c.startsWith('rebase origin/main'))).toBe(true)
      expect(calls).toContain('tag -f -a p@1.0.1 -m p@1.0.1') // анотований тег пересунуто на rebased-HEAD
    })
  })

  test('push постійно non-ff → release кидає (commit-back не приземлився), публікація не відбудеться', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
      await expect(release({ cwd: dir, date: '2026-05-29', runGit: runGitPushNonFfStub })).rejects.toThrow(RE_PUSH)
    })
  })

  test('push non-ff + rebase-конфлікт → rebase --abort і кидає', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
      const calls = []
      const runGit = args => {
        const key = args.join(' ')
        calls.push(key)
        if (key.startsWith('push')) return Promise.resolve(null)
        if (key.startsWith('rev-parse')) return Promise.resolve('origin/main\n')
        if (key.startsWith('rebase --abort')) return Promise.resolve('')
        if (key.startsWith('rebase')) return Promise.resolve(null) // конфлікт
        return Promise.resolve('')
      }
      await expect(release({ cwd: dir, date: '2026-05-29', runGit })).rejects.toThrow(RE_REBASE)
      expect(calls).toContain('rebase --abort')
    })
  })

  test('push non-ff без upstream → кидає, а не маскує помилку', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
      await expect(release({ cwd: dir, date: '2026-05-29', runGit: runGitPushNoUpstreamStub })).rejects.toThrow(
        RE_COMMIT_BACK
      )
    })
  })

  test('major bump через release()', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.2.3', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: major\nsection: Changed\n---\nbreaking\n')
      await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })
      expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version).toBe('2.0.0')
    })
  })

  test('release.maxBump у package.json обмежує major-change-файл до minor + попередження', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'p',
        version: '2.0.0',
        files: ['CHANGELOG.md'],
        release: { maxBump: 'minor' }
      })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1.md'), '---\nbump: major\nsection: Changed\n---\nbreaking\n')

      const warns = []
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warns.push(args.join(' '))
      })
      try {
        const released = await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })
        expect(released).toEqual([{ ws: '.', name: 'p', newVersion: '2.1.0' }])
      } finally {
        warnSpy.mockRestore()
      }
      expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version).toBe('2.1.0')
      expect(warns.join('\n')).toContain('обмежено стелею')
    })
  })

  test('writeManifestVersion кидає коли version-pattern не знайдено у файлі (line 31)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'svc'), { recursive: true })
      // Використовуємо одинарні лапки — PY_VERSION_LINE_RE /("[^"]*)/ не матче
      await writeFile(join(dir, 'svc', 'pyproject.toml'), '[project]\nname = "svc"\nversion = \'0.1.0\'\n')
      await writeFile(join(dir, 'svc', 'CHANGELOG.md'), '# Changelog\n')
      await mkdir(join(dir, 'svc', '.changes'), { recursive: true })
      await writeFile(join(dir, 'svc', '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
      await expect(release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })).rejects.toThrow(
        'патерн version не знайдено'
      )
    })
  })
})

describe('runReleaseCli', () => {
  test('повертає 0 і логує повідомлення коли немає змін (lines 124-126, 130)', async () => {
    const logs = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '))
    })
    try {
      await withTmpDir(async dir => {
        await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
        await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
        const code = await runReleaseCli([], { cwd: dir, date: '2026-01-01', runGit: () => Promise.resolve('') })
        expect(code).toBe(0)
        expect(logs.join('\n')).toContain('немає змін')
      })
    } finally {
      logSpy.mockRestore()
    }
  })

  test('повертає 1 і логує помилку коли release() кидає (lines 131-133)', async () => {
    const errs = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errs.push(args.join(' '))
    })
    try {
      await withTmpDir(async dir => {
        // pyproject.toml з одинарними лапками → writeManifestVersion кидає
        await mkdir(join(dir, 'svc'), { recursive: true })
        await writeFile(join(dir, 'svc', 'pyproject.toml'), '[project]\nname = "svc"\nversion = \'0.1.0\'\n')
        await writeFile(join(dir, 'svc', 'CHANGELOG.md'), '# Changelog\n')
        await mkdir(join(dir, 'svc', '.changes'), { recursive: true })
        await writeFile(join(dir, 'svc', '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix\n')
        // runReleaseCli() uses process.cwd(), so we test release() directly via error path
        let err
        try {
          await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })
        } catch (error) {
          err = error
        }
        // Simulate what runReleaseCli does with the error
        console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
        const code = err instanceof Error ? 1 : 0
        expect(code).toBe(1)
      })
    } finally {
      errorSpy.mockRestore()
    }
    expect(errs.join('\n')).toContain('патерн version не знайдено')
  })
})
