/**
 * Тести перейменування розширень **.yml** / **.yaml** (rename-yaml-extensions.mjs).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { runRenameYamlExtensionsCli } from '../bin/rename-yaml-extensions.mjs'
import {
  parseRenameYamlArgs,
  pathMatchesGithubYaml,
  pathMatchesK8sYml,
  renameYamlExtensions,
  replaceExtension
} from '../scripts/rename-yaml-extensions.mjs'
import { ensureDir, withTmpCwd } from './helpers.mjs'

describe('pathMatchesK8sYml', () => {
  test('true для …/k8s/…/f.yml', () => {
    expect(pathMatchesK8sYml('app/k8s/base/f.yml')).toBe(true)
  })

  test('false без сегмента k8s', () => {
    expect(pathMatchesK8sYml('app/other/f.yml')).toBe(false)
  })

  test('false для .yaml', () => {
    expect(pathMatchesK8sYml('app/k8s/f.yaml')).toBe(false)
  })
})

describe('pathMatchesGithubYaml', () => {
  test('true під .github', () => {
    expect(pathMatchesGithubYaml('.github/workflows/lint.yml')).toBe(false)
    expect(pathMatchesGithubYaml('.github/workflows/lint.yaml')).toBe(true)
  })

  test('true для вкладеного .github', () => {
    expect(pathMatchesGithubYaml('pkg/.github/foo.yaml')).toBe(true)
  })

  test('false поза .github', () => {
    expect(pathMatchesGithubYaml('workflows/foo.yaml')).toBe(false)
  })
})

describe('replaceExtension', () => {
  test('замінює суфікс', () => {
    expect(replaceExtension('a/b/c.yml', '.yaml')).toBe('a/b/c.yaml')
    expect(replaceExtension('a/b/c.yaml', '.yml')).toBe('a/b/c.yml')
  })
})

describe('parseRenameYamlArgs', () => {
  test('--dry-run та --root', () => {
    const r = parseRenameYamlArgs(['--dry-run', '--root=/tmp/x'])
    expect(r.dryRun).toBe(true)
    expect(r.root).toBe(resolve('/tmp/x'))
  })
})

describe('runRenameYamlExtensionsCli', () => {
  test('повертає 0, якщо немає кандидатів', async () => {
    await withTmpCwd(async () => {
      const code = await runRenameYamlExtensionsCli([])
      expect(code).toBe(0)
    })
  })
})

describe('renameYamlExtensions', () => {
  test('k8s .yml → .yaml та .github .yaml → .yml', async () => {
    await withTmpCwd(async () => {
      await ensureDir('app/k8s/base')
      await ensureDir('.github/workflows')
      await writeFile(join('app/k8s/base', 'd.yml'), 'x: 1\n', 'utf8')
      await writeFile(join('.github/workflows', 'wf.yaml'), 'on: {}\n', 'utf8')

      const { renamed, errors } = await renameYamlExtensions(process.cwd(), { dryRun: false })
      expect(errors).toEqual([])
      expect(renamed).toEqual([
        { relFrom: 'app/k8s/base/d.yml', relTo: 'app/k8s/base/d.yaml' },
        { relFrom: '.github/workflows/wf.yaml', relTo: '.github/workflows/wf.yml' }
      ])
      expect(existsSync(join('app/k8s/base', 'd.yaml'))).toBe(true)
      expect(existsSync(join('.github/workflows', 'wf.yml'))).toBe(true)
    })
  })

  test('dry-run не змінює файли', async () => {
    await withTmpCwd(async () => {
      await ensureDir('app/k8s')
      await writeFile(join('app/k8s', 'x.yml'), 'a: 1\n', 'utf8')
      const { renamed, errors } = await renameYamlExtensions(process.cwd(), { dryRun: true })
      expect(errors).toEqual([])
      expect(renamed).toHaveLength(1)
      expect(existsSync(join('app/k8s', 'x.yml'))).toBe(true)
      expect(existsSync(join('app/k8s', 'x.yaml'))).toBe(false)
    })
  })
})
