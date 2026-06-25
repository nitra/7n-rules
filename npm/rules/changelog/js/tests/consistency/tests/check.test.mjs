/**
 * Тести rules/changelog/js/consistency.mjs.
 *
 * Модель: change-файл `<ws>/.changes/*.md` — єдиний дозволений спосіб зафіксувати зміну;
 * bump version робить лише CI. Будь-який drift `version` (vs опублікована або vs git-база)
 * — ручний bump поза CI — завалює перевірку на будь-якій гілці, навіть із change-файлом.
 *
 * Дві моделі бази:
 * - npm/PyPI-published: порівняння локальної version з опублікованою (стаб getPublishedVersion).
 * - local-only (private/без files): PR-scoped перевірка проти `dev`/`main` через `git merge-base`.
 *
 * Контракт: `withTmpDir(fn)` створює tmp-каталог; усі шляхи через `join(dir, …)`,
 * `git` отримує `cwd: dir`, `checkChangelog` — `{ cwd: dir }`. Без `process.chdir`.
 */
import { describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { promisify } from 'node:util'

import { check as checkChangelog } from '../../../consistency.mjs'
import { readChangeFiles } from '../../../../../release/lib/change-file.mjs'
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
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
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

  test('version = опублікованій, feature-гілка: change-файл → pass', async () => {
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
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('локальна version != опублікованій (ручний bump) → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.1'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('локальна version ПОЗАДУ опублікованої (локаль відстала від CI-релізу), без git → pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '3.19.0',
        files: ['types', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('3.19.0'), 'utf8')
      // published 3.20.0 > local 3.19.0 — це не ручний bump, а ще не підтягнутий git pull.
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '3.20.0' }) })
      expect(code).toBe(0)
    })
  })

  test('version ПОЗАДУ опублікованої + change-файл → pass (не ручний bump)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '3.19.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('3.19.0'), 'utf8')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Added\n---\nx\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '3.20.0' }) })
      expect(code).toBe(0)
    })
  })

  test('version ПОПЕРЕДУ опублікованої на major (ручний bump) → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '2.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('2.0.0'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.5.0' }) })
      expect(code).toBe(1)
    })
  })

  test('version = опублікованій, є change-файл, але files без "CHANGELOG.md" → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['types']
      })
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Added\n---\nFix\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('npm-published: change-файл + версія != реєстру → fail (drift має пріоритет)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.1',
        files: ['lib', 'CHANGELOG.md']
      })
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
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
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.1'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: offlineStub })
      expect(code).toBe(0)
    })
  })
})

describe('check-changelog (local-only mode skip-логіка)', () => {
  test('private workspace без git → pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('private workspace на dev (інтеграційна гілка) → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('private workspace без ref dev/origin/dev → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'main'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
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

  test('feature-гілка: ручний bump version → fail (заборонено)', async () => {
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
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('local-only: change-файл + ручний bump version → fail (drift має пріоритет)', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.1.0', private: true })
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: minor\nsection: Changed\n---\nx\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(1)
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

  test('feature-гілка: новий воркспейс із change-файлом → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: 'mono',
        version: '1.0.0',
        private: true,
        workspaces: ['demo']
      })
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
      await writeFile(join(dir, 'demo', 'CHANGELOG.md'), '# Changelog\n', 'utf8')
      await writeFile(join(dir, 'demo', 'app.js'), 'x\n', 'utf8')
      await mkdir(join(dir, 'demo', '.changes'), { recursive: true })
      await writeFile(
        join(dir, 'demo', '.changes', '1-a.md'),
        '---\nbump: minor\nsection: Added\n---\nновий пакет\n',
        'utf8'
      )
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('feature-гілка: новий воркспейс без change-файлу → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: 'mono',
        version: '1.0.0',
        private: true,
        workspaces: ['demo']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/demo'], dir)
      await ensureDir(join(dir, 'demo'))
      await writeJson(join(dir, 'demo', 'package.json'), { name: 'demo', version: '0.0.0', private: true })
      await writeFile(join(dir, 'demo', 'app.js'), 'x\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('зміна тільки в одному з воркспейсів — інший не вимагає bump', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: 'mono',
        version: '1.0.0',
        private: true,
        workspaces: ['a', 'b']
      })
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
      await mkdir(join(dir, 'a', '.changes'), { recursive: true })
      await writeFile(join(dir, 'a', '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('main: ручний bump version поза CI → fail', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'main'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
      // ручний bump на main без change-файлу
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.1.0', private: true })
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'manual bump'], dir)
      expect(await checkChangelog({ cwd: dir })).toBe(1)
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

  test('local-only (python): change-файл → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writePyproject({ version: '1.0.0' }, dir)
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await writeFile(join(dir, 'app.py'), '#\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.py'), 'print(1)\n', 'utf8')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })

  test('PyPI-published: version != реєстру (ручний bump) → fail', async () => {
    await withTmpDir(async dir => {
      await writePyproject({ name: 'my-lib', version: '2.0.1' }, dir)
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('2.0.1'), 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ 'my-lib': '2.0.0' }) })
      expect(code).toBe(1)
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
  test('npm-published в sync, app з change-файлом → pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), {
        name: 'mono',
        version: '1.0.0',
        private: true,
        workspaces: ['npm', 'app']
      })
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

      // local-only зміна в app з change-файлом
      await writeFile(join(dir, 'app', 'bar.js'), 'y\n', 'utf8')
      await mkdir(join(dir, 'app', '.changes'), { recursive: true })
      await writeFile(join(dir, 'app', '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')

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

test('наявність change-файлу задовольняє вимогу замість bump (local-only feature-гілка)', async () => {
  await withTmpDir(async dir => {
    await git(['init', '-b', 'main'], dir)
    await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', private: true })
    await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
    await git(['add', '-A'], dir)
    await git(['commit', '-m', 'init'], dir)
    await git(['checkout', '-b', 'feat'], dir)
    await writeFile(join(dir, 'src.mjs'), 'export const x = 1\n')
    await mkdir(join(dir, '.changes'), { recursive: true })
    await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Added\n---\nx\n')

    const code = await checkChangelog({ cwd: dir })
    expect(code).toBe(0)
  }, 30000)
}, 30000)

describe('check-changelog (npm-published: відсутня version або uncommitted зміни)', () => {
  test('npm-published без version у package.json → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        files: ['types']
      })
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('npm-published: version = реєстру + є change-файл → pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', 'my-change.md'), '---\nbump: patch\nsection: Added\n---\nFix\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(0)
    })
  })

  test('npm-published на dev: version = реєстру, uncommitted зміни → fail', async () => {
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
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('npm-published на main: uncommitted зміни без bump → fail', async () => {
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
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })
})

describe('check-changelog (edge cases — coverage)', () => {
  test('воркспейс із невалідним package.json → пропускається (line 572)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'mono', workspaces: ['sub'] })
      await ensureDir(join(dir, 'sub'))
      await writeFile(join(dir, 'sub/package.json'), '"not-an-object"', 'utf8')
      const code = await checkChangelog({ cwd: dir })
      expect(code).toBe(0)
    })
  })

  test('feature-гілка без гілок dev/main → resolveChangelogComparisonPoint null → pass (line 194)', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'other-base'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')
      const code = await checkChangelog({ cwd: dir })
      expect(code).toBe(0)
    })
  })
})

/**
 * Імена застейджених шляхів (`git diff --cached --name-only`) у заданому `cwd`.
 * @param {string} cwd робочий каталог
 * @returns {Promise<string[]>} список застейджених шляхів
 */
async function stagedPaths(cwd) {
  const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd })
  return stdout.split('\n').filter(Boolean)
}

describe('check-changelog (autofix-режим)', () => {
  test('npm-published feature-гілка без change-файлу + autofix → створює change-файл і pass', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: '@x/lib', version: '1.0.0', files: ['lib', 'CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'lib'))
      await writeFile(join(dir, 'lib/x.js'), '//\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'feat: щось важливе'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')

      const code = await checkChangelog({
        cwd: dir,
        autofix: true,
        getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' })
      })
      expect(code).toBe(0)

      const changes = await readChangeFiles('.', dir)
      expect(changes).toHaveLength(1)
      expect(changes[0].entry).toMatchObject({ bump: 'patch', section: 'Changed', description: 'feat: щось важливе' })
    })
  })

  test('autofix не викликає резолвер опублікованої версії (без npm view / мережі)', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: '@x/lib', version: '1.0.0', files: ['lib', 'CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await ensureDir(join(dir, 'lib'))
      await writeFile(join(dir, 'lib/x.js'), '//\n', 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')

      let called = false
      const spyResolver = (_name, _kind) => {
        called = true
        return Promise.resolve('1.0.0')
      }
      const code = await checkChangelog({ cwd: dir, autofix: true, getPublishedVersion: spyResolver })
      expect(code).toBe(0)
      expect(called).toBe(false)
      expect(await readChangeFiles('.', dir)).toHaveLength(1)
    })
  })

  test('autofix ставить створений change-файл у git-індекс', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')

      const code = await checkChangelog({ cwd: dir, autofix: true })
      expect(code).toBe(0)
      const changes = await readChangeFiles('.', dir)
      expect(await stagedPaths(dir)).toContain('.changes/' + changes[0].file)
    })
  })

  test('autofix вмикається через env N_CURSOR_CHANGELOG_AUTOFIX=1', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')

      const prev = env.N_CURSOR_CHANGELOG_AUTOFIX
      env.N_CURSOR_CHANGELOG_AUTOFIX = '1'
      try {
        expect(await checkChangelog({ cwd: dir })).toBe(0)
      } finally {
        if (prev === undefined) delete env.N_CURSOR_CHANGELOG_AUTOFIX
        else env.N_CURSOR_CHANGELOG_AUTOFIX = prev
      }
      expect(await readChangeFiles('.', dir)).toHaveLength(1)
    })
  })

  test('autofix вимкнено (за замовчуванням) → fail без створення файлу', async () => {
    await withTmpDir(async dir => {
      await git(['init', '-q', '-b', 'dev'], dir)
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
      await git(['add', '-A'], dir)
      await git(['commit', '-q', '-m', 'init'], dir)
      await git(['checkout', '-q', '-b', 'feat/x'], dir)
      await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')

      expect(await checkChangelog({ cwd: dir, autofix: false })).toBe(1)
      expect(await readChangeFiles('.', dir)).toHaveLength(0)
    })
  })
})

describe('check-changelog (CHANGELOG.md existence + format)', () => {
  test('1 — npm-published: відсутній CHANGELOG.md → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('1 — local-only: відсутній CHANGELOG.md → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      expect(await checkChangelog({ cwd: dir })).toBe(1)
    })
  })

  test('1 — npm-published: CHANGELOG.md без рядка "# Changelog" → fail', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: '@x/lib',
        version: '1.0.0',
        files: ['lib', 'CHANGELOG.md']
      })
      await writeFile(join(dir, 'CHANGELOG.md'), '## [1.0.0] - 2026-01-01\n\n### Added\n\n- x\n', 'utf8')
      const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
      expect(code).toBe(1)
    })
  })

  test('0 — local-only: CHANGELOG.md лише з "# Changelog" (новий workspace) → pass', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n', 'utf8')
      expect(await checkChangelog({ cwd: dir })).toBe(0)
    })
  })
})
