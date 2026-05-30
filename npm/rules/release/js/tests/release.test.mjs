import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

import { release } from '../../release.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

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
      expect(gitCalls.some(c => c.startsWith('tag p@1.3.0'))).toBe(true)
      expect(gitCalls.some(c => c.startsWith('commit'))).toBe(true)
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
})
