/**
 * Тести rules/changelog/fix.mjs.
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

import { check as checkChangelog } from '../../../consistency.mjs'
import { ensureDir, withTmpCwd, writeJson } from '../../../../../../scripts/utils/test-helpers.mjs'

const execFileAsync = promisify(execFile)

/**
 * Викликає `git` із заглушеним global config (для CI).
 * @param {string[]} args аргументи `git`-команди
 * @returns {Promise<void>} резолвиться по завершенню `git`-команди
 */
async function git(args) {
  await execFileAsync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', '-c', 'commit.gpgsign=false', ...args],
    { cwd: process.cwd() }
  )
}

/**
 * Стандартний шаблон CHANGELOG.md із записом для версії.
 * @param {string} version версія для запису у форматі Keep a Changelog
 * @param {string} [date] дата запису у форматі `YYYY-MM-DD` (за замовчуванням `'2026-05-05'`)
 * @returns {string} вміст CHANGELOG.md з одним записом
 */
function changelogWithVersion(version, date = '2026-05-05') {
  return `# Changelog\n\n## [${version}] - ${date}\n\n### Added\n\n- ...\n`
}

/**
 * Стаб getPublishedVersion: повертає мапу name → version, або null для відсутніх.
 * @param {Record<string, string>} map мапа `name → version` для віддавання як «опубліковані».
 * @returns {(name: string) => Promise<string | null>} async-стаб з тією ж сигнатурою, що і `getPublishedVersion`.
 */
function publishedStub(map) {
  return (name, _kind) => Promise.resolve(Object.hasOwn(map, name) ? map[name] : null)
}

/**
 * @param {{ name?: string, version: string }} fields поля pyproject
 * @param {string} [dir] директорія
 */
async function writePyproject(fields, dir = '.') {
  const lines = ['[project]']
  if (fields.name) {
    lines.push(`name = "${fields.name}"`)
  }
  lines.push(`version = "${fields.version}"`)
  await writeFile(join(dir, 'pyproject.toml'), `${lines.join('\n')}\n`, 'utf8')
}

/**
 * Завжди-null стаб (registry недосяжний / пакет не публікувався).
 * @returns {Promise<null>} завжди резолвиться у `null`, імітуючи недоступність npm-реєстру.
 */
const offlineStub = () => Promise.resolve(null)

describe('check-changelog (npm-published mode)', () => {
  test('локальна version = опублікованій, без git → pass без вимог', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.0',
        files: ['types']
      })
      // CHANGELOG взагалі немає — це OK, бо нічого не зрелізнуто і немає git-змін
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('version = опублікованій, feature-гілка зі змінами без bump → fail', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir('lib')
      await writeFile('lib/x.js', '//\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('lib/x.js', 'changed\n', 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('version = опублікованій, feature-гілка: лише docs/ без bump → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir('lib')
      await writeFile('lib/x.js', '//\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/docs'])
      await ensureDir('docs')
      await writeFile('docs/readme.md', '# doc\n', 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('version = опублікованій, база main (без dev), зміни без bump → fail', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'main'])
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir('lib')
      await writeFile('lib/x.js', '//\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('lib/x.js', 'changed\n', 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('version = опублікованій, feature-гілка: bump + CHANGELOG → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir('lib')
      await writeFile('lib/x.js', '//\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('lib/x.js', 'changed\n', 'utf8')
      await writeJson('package.json', {
        name: '@x/lib',
        version: '1.0.1',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile('CHANGELOG.md', `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`, 'utf8')
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

  test('private workspace на dev (інтеграційна гілка) → pass', async () => {
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
  test('feature-гілка: лише docs/ без bump → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/docs'])
      await ensureDir('docs')
      await writeFile('docs/note.md', 'x\n', 'utf8')
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('feature-гілка: лише синк tooling (.cursor/, .claude/) без bump → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/sync'])
      await ensureDir(join('.cursor', 'rules'))
      await writeFile(join('.cursor', 'rules', 'n-adr.mdc'), '# rule\n', 'utf8')
      await ensureDir(join('.claude', 'hooks'))
      await writeFile(join('.claude', 'hooks', 'normalize.sh'), '#!/bin/sh\n', 'utf8')
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('feature-гілка: untracked файл з не-ASCII назвою під docs/ → pass (quotePath -z)', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/docs'])
      await ensureDir('docs')
      await writeFile(join('docs', 'нотатка-про-зміни.md'), '# нотатка\n', 'utf8')
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('монорепо: зміна root-файлу без bump кореня → pass (корінь не перевіряється)', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true, workspaces: ['pkg'] })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir('pkg')
      await writeJson(join('pkg', 'package.json'), { name: 'pkg', version: '1.0.0', private: true })
      await writeFile(join('pkg', 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/root'])
      await writeFile('root-tool.js', 'x\n', 'utf8')
      expect(await checkChangelog()).toBe(0)
    })
  })

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

  test('main після merge dev → main: origin/main = HEAD, diff порожній → pass', async () => {
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
      // потім dev → main (merge --no-ff)
      await git(['checkout', '-q', 'main'])
      await git(['merge', '-q', '--no-ff', '--no-edit', 'dev'])
      // на main база = origin/main (попередній опублікований main), не dev
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
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
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      // direct-commit на main без bump (порівняння з origin/main, не dev)
      await writeFile('hotfix.js', 'h\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'hotfix'])
      expect(await checkChangelog()).toBe(1)
    })
  })

  test('main синхронізований з origin/main без локальних змін → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'main'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('main без dev: direct-commit vs origin/main → fail', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'main'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await writeFile('hotfix.js', 'h\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'hotfix'])
      expect(await checkChangelog()).toBe(1)
    })
  })

  test('feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writeJson('package.json', { name: 'mono', version: '1.0.0', private: true, workspaces: ['demo'] })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/demo'])
      await ensureDir('demo')
      await writeJson(join('demo', 'package.json'), {
        name: 'demo',
        version: '0.0.0',
        private: true
      })
      await writeFile(join('demo', 'CHANGELOG.md'), changelogWithVersion('0.0.0'), 'utf8')
      await writeFile(join('demo', 'app.js'), 'x\n', 'utf8')
      expect(await checkChangelog()).toBe(0)
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

describe('check-changelog (Python pyproject.toml)', () => {
  test('local-only: лише version без name, feature-гілка без bump → fail', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writePyproject({ version: '1.0.0' })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await writeFile('app.py', '#\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('app.py', 'print(1)\n', 'utf8')
      expect(await checkChangelog()).toBe(1)
    })
  })

  test('local-only: bump + CHANGELOG → pass', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writePyproject({ version: '1.0.0' })
      await writeFile('CHANGELOG.md', changelogWithVersion('1.0.0'), 'utf8')
      await writeFile('app.py', '#\n', 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('app.py', 'print(1)\n', 'utf8')
      await writePyproject({ version: '1.0.1' })
      await writeFile('CHANGELOG.md', `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`, 'utf8')
      expect(await checkChangelog()).toBe(0)
    })
  })

  test('PyPI-published: version != реєстру + CHANGELOG → pass', async () => {
    await withTmpCwd(async () => {
      await writePyproject({ name: 'my-lib', version: '2.0.1' })
      await writeFile('CHANGELOG.md', changelogWithVersion('2.0.1'), 'utf8')
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ 'my-lib': '2.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('PyPI-published: version != реєстру без CHANGELOG → fail', async () => {
    await withTmpCwd(async () => {
      await writePyproject({ name: 'my-lib', version: '2.0.1' })
      const code = await checkChangelog({ getPublishedVersion: publishedStub({ 'my-lib': '2.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('python-only репо без package.json виявляється через pyproject.toml', async () => {
    await withTmpCwd(async () => {
      await git(['init', '-q', '-b', 'dev'])
      await writePyproject({ version: '0.1.0' })
      await writeFile('CHANGELOG.md', changelogWithVersion('0.1.0'), 'utf8')
      await git(['add', '-A'])
      await git(['commit', '-q', '-m', 'init'])
      await git(['checkout', '-q', '-b', 'feat/x'])
      await writeFile('main.py', 'x = 1\n', 'utf8')
      expect(await checkChangelog()).toBe(1)
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
      // без git: перевірка лише version vs registry
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
