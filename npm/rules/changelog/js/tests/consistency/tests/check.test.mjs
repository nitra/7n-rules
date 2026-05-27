/**
 * Тести rules/changelog/fix.mjs.
 *
 * Дві моделі бази:
 * - npm-published: порівняння локальної version з опублікованою (через стаб getPublishedVersion).
 * - local-only (private/без files): PR-scoped перевірка проти `dev` через `git merge-base`.
 *
 * Сценарії: skip-логіка local-only, npm-mode (sync / out-of-sync / без CHANGELOG / без files /
 * registry недосяжний), merge-base (feature-гілка, main після merge, direct-commit на main).
 *
 * Контракт: `withTmpDir(fn)` створює tmp-каталог; усі шляхи будуються через `join(dir, …)`,
 * `git` отримує `cwd: dir`, `checkChangelog` — `{ cwd: dir }`. Без `process.chdir`.
 */
import { describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { check as checkChangelog } from '../../../consistency.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../../../scripts/utils/test-helpers.mjs'

const execFileAsync = promisify(execFile)

/**
 * Викликає `git` із заглушеним global config (для CI) у заданому `cwd`.
 * @param {string[]} args аргументи `git`-команди
 * @param {string} cwd робочий каталог
 * @returns {Promise<void>} визначається по завершенню `git`-команди
 */
async function git(args, cwd) {
  await execFileAsync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', '-c', 'commit.gpgsign=false', ...args],
    { cwd }
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
 * @param {string} dir абсолютний каталог
 * @param {string} [sub] підкаталог (відносний; за замовчуванням '.')
 */
async function writePyproject(fields, dir, sub = '.') {
  const lines = ['[project]']
  if (fields.name) {
    lines.push(`name = "${fields.name}"`)
  }
  lines.push(`version = "${fields.version}"`)
  await writeFile(join(dir, sub, 'pyproject.toml'), `${lines.join('\n')}\n`, 'utf8')
}

/**
 * Завжди-null стаб (registry недосяжний / пакет не публікувався).
 * @returns {Promise<null>} завжди визначається у `null`, імітуючи недоступність npm-реєстру.
 */
const offlineStub = () => Promise.resolve(null)

describe('check-changelog (npm-published mode)', () => {
  test('локальна version = опублікованій, без git → pass без вимог', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['types']
      })
      // CHANGELOG взагалі немає — це OK, бо нічого не зрелізнуто і немає git-змін
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('version = опублікованій, feature-гілка зі змінами без bump → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'lib'))
      await writeFile(join(dir, 'lib/x.js'), '//\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('version = опублікованій, feature-гілка: лише docs/ без bump → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'lib'))
      await writeFile(join(dir, 'lib/x.js'), '//\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/docs'], dir)
      await ensureDir(join(dir, 'docs'))
      await writeFile(join(dir, 'docs/readme.md'), '# doc\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('version = опублікованій, база main (без dev), зміни без bump → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'main'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'lib'))
      await writeFile(join(dir, 'lib/x.js'), '//\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('version = опублікованій, feature-гілка: bump + CHANGELOG → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'lib'))
      await writeFile(join(dir, 'lib/x.js'), '//\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('локальна version != опублікованій + CHANGELOG + files=["CHANGELOG.md"] → pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.1'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('локальна version != опублікованій без CHANGELOG → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('локальна version != опублікованій, CHANGELOG є, але без запису для нової версії → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('локальна version != опублікованій, files без "CHANGELOG.md" → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.1'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('реєстр недосяжний (null) → fail-safe pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types']
      })
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: offlineStub })
      expect(code).toBe(0)
    })
  })
})

describe('check-changelog (local-only mode skip-логіка)', () => {
  test('private workspace без git → pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('private workspace на dev (інтеграційна гілка) → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('private workspace без ref dev/origin/dev → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'main'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })
})

describe('check-changelog (local-only merge-base логіка)', () => {
  test('feature-гілка: лише docs/ без bump → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/docs'], dir)
      await ensureDir(join(dir, 'docs'))
      await writeFile(join(dir, 'docs/note.md'), 'x\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('feature-гілка: лише синк tooling (.cursor/, .claude/) без bump → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/sync'], dir)
      await ensureDir(join(dir, '.cursor', 'rules'))
      await writeFile(join(dir, '.cursor', 'rules', 'n-adr.mdc'), '# rule\n', 'utf8')
      await ensureDir(join(dir, '.claude', 'hooks'))
      await writeFile(join(dir, '.claude', 'hooks', 'normalize.sh'), '#!/bin/sh\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('feature-гілка: untracked файл з не-ASCII назвою під docs/ → pass (quotePath -z)', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/docs'], dir)
      await ensureDir(join(dir, 'docs'))
      await writeFile(join(dir, 'docs', 'нотатка-про-зміни.md'), '# нотатка\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('монорепо: зміна root-файлу без bump кореня → pass (корінь не перевіряється)', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true, workspaces: ['pkg'] })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'pkg'))
      await writeJson(join(dir, 'pkg', 'package.json'), { name: 'pkg', version: '1.0.0', private: true })
      await writeFile(join(dir, 'pkg', 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/root'], dir)
      await writeFile(join(dir, 'root-tool.js'), 'x\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('feature-гілка зі змінами без bump → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('feature-гілка: bump + запис → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.1.0', private: true })
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        `${changelogWithVersion('1.1.0')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('main після merge dev → main: origin/main = HEAD, diff порожній → pass', async () => {
    await withTmpDir(async dir => {
      // dev створено, init на dev
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      // створюємо main з dev
      await git(['checkout', '-q', '-b', 'main'], dir)
      // далі feature → dev (merge-commit на dev): симулюємо, що dev отримав комерсіал
      await git(['checkout', '-q', 'dev'], dir)
      await writeFile(join(dir, 'feature.js'), 'y\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.1.0', private: true })
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        `${changelogWithVersion('1.1.0')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'feat'], dir)
      // потім dev → main (merge --no-ff)
      await git(['checkout', '-q', 'main'], dir)
      await git(['merge', '-q', '--no-ff', '--no-edit', 'dev'], dir)
      // на main база = origin/main (попередній опублікований main), не dev
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('main з direct-commit поза PR-flow → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'main'], dir)
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
      // direct-commit на main без bump (порівняння з origin/main, не dev)
      await writeFile(join(dir, 'hotfix.js'), 'h\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'hotfix'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('main синхронізований з origin/main без локальних змін → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'main'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('main без dev: direct-commit vs origin/main → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'main'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
      await writeFile(join(dir, 'hotfix.js'), 'h\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'hotfix'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true, workspaces: ['demo'] })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/demo'], dir)
      await ensureDir(join(dir, 'demo'))
      await writeJson(join(dir, 'demo', 'package.json'), {
        name: 'demo',
        version: '0.0.0',
        private: true
      })
      await writeFile(join(dir, 'demo', 'CHANGELOG.md'), changelogWithVersion('0.0.0'), 'utf8')
      await writeFile(join(dir, 'demo', 'app.js'), 'x\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('зміна тільки в одному з воркспейсів — інший не вимагає bump', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true, workspaces: ['a', 'b'] })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      for (const ws of ['a', 'b']) {
        await ensureDir(join(dir, ws))
        await writeJson(join(dir, ws, 'package.json'), { name: ws, version: '1.0.0', private: true })
        await writeFile(join(dir, ws, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      }
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)

      // змінюємо лише `a`
      await writeFile(join(dir, 'a', 'x.js'), 'x\n', 'utf8')
      await writeJson(join(dir, 'a', 'package.json'), { name: 'a', version: '1.0.1', private: true })
      await writeFile(
        join(dir, 'a', 'CHANGELOG.md'),
        `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })
})

describe('check-changelog (Python pyproject.toml)', () => {
  test('local-only: лише version без name, feature-гілка без bump → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writePyproject({ version: '1.0.0' }, dir)
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await writeFile(join(dir, 'app.py'), '#\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.py'), 'print(1)\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('local-only: bump + CHANGELOG → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writePyproject({ version: '1.0.0' }, dir)
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await writeFile(join(dir, 'app.py'), '#\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.py'), 'print(1)\n', 'utf8')
      await writePyproject({ version: '1.0.1' }, dir)
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('PyPI-published: version != реєстру + CHANGELOG → pass', async () => {
    await withTmpDir(async dir => {
      await writePyproject({ name: 'my-lib', version: '2.0.1' }, dir)
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('2.0.1'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ 'my-lib': '2.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('PyPI-published: version != реєстру без CHANGELOG → fail', async () => {
    await withTmpDir(async dir => {
      await writePyproject({ name: 'my-lib', version: '2.0.1' }, dir)
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ 'my-lib': '2.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('python-only репо без package.json виявляється через pyproject.toml', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writePyproject({ version: '0.1.0' }, dir)
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('0.1.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'main.py'), 'x = 1\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })
})

describe('check-changelog (змішаний режим: npm-published + local-only в монорепо)', () => {
  test('npm-published в sync, app з bump+entry → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true, workspaces: ['npm', 'app'] })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm', 'package.json'), {
        name: '@x/lib',
        version: '2.0.0',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'npm', 'CHANGELOG.md'), changelogWithVersion('2.0.0'), 'utf8')
      await ensureDir(join(dir, 'app'))
      await writeJson(join(dir, 'app', 'package.json'), { name: 'app', version: '1.0.0', private: true })
      await writeFile(join(dir, 'app', 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)

      // local-only зміна в app з bump
      await writeFile(join(dir, 'app', 'bar.js'), 'y\n', 'utf8')
      await writeJson(join(dir, 'app', 'package.json'), { name: 'app', version: '1.0.1', private: true })
      await writeFile(
        join(dir, 'app', 'CHANGELOG.md'),
        `${changelogWithVersion('1.0.1')}\n${changelogWithVersion('1.0.0')}`,
        'utf8'
      )

      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '2.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('npm-published з невипущеним bump-ом без CHANGELOG → fail (незалежно від git)', async () => {
    await withTmpDir(async dir => {
      // без git: перевірка лише version vs registry
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true, workspaces: ['npm'] })
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm', 'package.json'), {
        name: '@x/lib',
        version: '2.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      // CHANGELOG нема для 2.0.1
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '2.0.0' }) })
      expect(code).toBe(1)
    })
  })
})
