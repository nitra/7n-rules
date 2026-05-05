/**
 * Тести check-changelog.mjs.
 *
 * Дві моделі бази:
 * - npm-published: порівняння локальної version з опублікованою (через стаб getPublishedVersion).
 * - local-only (private/без files): PR-scoped перевірка проти `dev` через `git merge-base`.
 *
 * Сценарії: skip-логіка local-only, npm-mode (sync / out-of-sync / без CHANGELOG / без files /
 * registry недосяжний), merge-base (feature-гілка, main після merge, direct-commit на main).
 */
import { describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { check as checkChangelog } from '../scripts/check-changelog.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

const execFileAsync = promisify(execFile)

/** Викликає `git` із заглушеним global config (для CI). */
async function git(args) {
  await execFileAsync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', '-c', 'commit.gpgsign=false', ...args],
    { cwd: process.cwd() }
  )
}

/** Стандартний шаблон CHANGELOG.md із записом для версії. */
function changelogWithVersion(version, date = '2026-05-05') {
  return `# Changelog\n\n## [${version}] - ${date}\n\n### Added\n\n- ...\n`
}

/**
 * Стаб getPublishedVersion: повертає мапу name → version, або null для відсутніх.
 * @param {Record<string, string>} map мапа `name → version` для віддавання як «опубліковані».
 * @returns {(name: string) => Promise<string | null>} async-стаб з тією ж сигнатурою, що і `getPublishedVersion`.
 */
function publishedStub(map) {
  return name => Promise.resolve(Object.hasOwn(map, name) ? map[name] : null)
}

/**
 * Завжди-null стаб (registry недосяжний / пакет не публікувався).
 * @returns {Promise<null>} завжди резолвиться у `null`, імітуючи недоступність npm-реєстру.
 */
const offlineStub = () => Promise.resolve(null)

describe('check-changelog (npm-published mode)', () => {
  test('локальна version = опублікованій → pass без вимог', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.0',
        files: ['types']
      })
      // CHANGELOG взагалі немає — це OK, бо нічого не зрелізнуто
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('локальна version != опублікованій + CHANGELOG + files=["CHANGELOG.md"] → pass', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.1'), 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('локальна version != опублікованій без CHANGELOG → fail', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('локальна version != опублікованій, CHANGELOG є, але без запису для нової версії → fail', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('локальна version != опублікованій, files без "CHANGELOG.md" → fail', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.1'), 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('реєстр недосяжний (null) → fail-safe pass', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types']
      })
      const code = await checkChangelog({ getPublishedVersion: offlineStub })
      expect(code).toBe(0)
    })
  })
})

describe('check-changelog (local-only mode skip-логіка)', () => {
  test('private workspace без git → pass', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('private workspace на dev → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('private workspace без ref dev/origin/dev → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'main'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      expect(await checkChangelog()).toBe(0)
    })
  })
})

describe('check-changelog (local-only merge-base логіка)', () => {
  test('feature-гілка зі змінами без bump → fail', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('app.js', 'x\n', 'utf8')
      expect(await checkChangelog()).toBe(1)
    })
  })

  test('feature-гілка: bump + запис → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('app.js', 'x\n', 'utf8')
      await writeJson('package.json', { name: 'mono', version: '1.1.0', private: true })
      await writeFile('CHANGELOG.md', `${changelogWithVersion('1.1.0')}\n${changelogWithVersion('1.0.0')}`, 'utf8')
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('main після merge dev → main: merge-base = dev, diff порожній → pass', async () => {
    await withTmpCwd(async () => {
      // dev створено, init на dev
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      // створюємо main з dev
      await git(['checkout', '-q', '-b', 'main'])
      // далі feature → dev (merge-commit на dev): симулюємо, що dev отримав комерсіал
      await git(['checkout', '-q', 'dev'])
      await writeFile('feature.js', 'y\n', 'utf8')
      await writeJson('package.json', { name: 'mono', version: '1.1.0', private: true })
      await writeFile('CHANGELOG.md', `${changelogWithVersion('1.1.0')}\n${changelogWithVersion('1.0.0')}`, 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'feat'])
      // потім dev → main (fast-forward / merge --no-ff не критично)
      await git(['checkout', '-q', 'main'])
      await git(['merge', '-q', '--no-ff', '--no-edit', 'dev'])
      // тепер ми на main, merge-base(dev, HEAD) = поточний dev → diff порожній
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('main з direct-commit поза PR-flow → fail', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'main'])
      // direct-commit на main без bump
      await writeFile('hotfix.js', 'h\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'hotfix'])
      expect(await checkChangelog()).toBe(1)
    })
  })

  test('зміна тільки в одному з воркспейсів — інший не вимагає bump', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true, workspaces: ['a', 'b'] })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      for (const ws of ['a', 'b']) {
        await ensureDir(ws)
        await writeJson(join(ws, 'package.json'), { name: ws, version: '1.0.0', private: true })
        await writeFile(join(ws, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      }
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])

      // змінюємо лише `a`
      await writeFile(join('a', 'x.js'), 'x\n', 'utf8')
      await writeJson(join('a', 'package.json'), { name: 'a', version: '1.0.1', private: true })
      await writeFile(
        join('a', 'CHANGELOG.md'),
        `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )
      expect(await checkChangelog()).toBe(0)
    })
  })
})

describe('check-changelog (змішаний режим: npm-published + local-only в монорепо)', () => {
  test('npm-published в sync, app з bump+entry → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true, workspaces: ['npm', 'app'] })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir('npm')
      await writeJson(join('npm', 'package.json'), {
        name: '@x/lib',
        version: '2.0.0',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile(join('npm', 'CHANGELOG.md'), changelogWithVersion('2.0.0'), 'utf8')
      await ensureDir('app')
      await writeJson(join('app', 'package.json'), { name: 'app', version: '1.0.0', private: true })
      await writeFile(join('app', 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])

      // local-only зміна в app з bump
      await writeFile(join('app', 'bar.js'), 'y\n', 'utf8')
      await writeJson(join('app', 'package.json'), { name: 'app', version: '1.0.1', private: true })
      await writeFile(
        join('app', 'CHANGELOG.md'),
        `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )

      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '2.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('npm-published з невипущеним bump-ом без CHANGELOG → fail (незалежно від git)', async () => {
    await withTmpCwd(async () => {
      // навіть без git: published-режим не використовує git
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true, workspaces: ['npm'] })
      await ensureDir('npm')
      await writeJson(join('npm', 'package.json'), {
        name: '@x/lib',
        version: '2.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      // CHANGELOG нема для 2.0.1
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '2.0.0' }) })
      expect(code).toBe(1)
    })
  })
})
