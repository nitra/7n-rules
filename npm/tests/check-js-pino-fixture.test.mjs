/**
 * Тести check-js-pino на workspace-пакетах.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../scripts/check-js-pino.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

/**
 * Monorepo `workspaces: ['pkg']` і мінімальний `pkg/package.json` з залежностями.
 * @param {Record<string, string>} pkgDependencies залежності workspace-пакета
 * @returns {Promise<void>} завершується після запису файлів
 */
async function writeRootWithWorkspacePkg(pkgDependencies) {
  await writeJson('package.json', {
    name: 'r',
    private: true,
    workspaces: ['pkg']
  })
  await ensureDir('pkg')
  await writeJson(join('pkg', 'package.json'), {
    name: 'pkg',
    dependencies: pkgDependencies
  })
}

describe('check-js-pino (мінімальний проєкт)', () => {
  test('0, якщо немає workspace-пакетів окрім кореня', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'r', private: true })
      expect(await check()).toBe(0)
    })
  })

  test('1, якщо в workspace-пакеті є bunyan', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ bunyan: '^1.8.0' })
      expect(await check()).toBe(1)
    })
  })

  test('1, якщо у джерелах workspace-пакета лишився import з @nitra/bunyan', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(join('pkg', 'index.js'), `import log from '@nitra/bunyan'\nlog.info('start')\n`, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('0, якщо джерела використовують лише @nitra/pino', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(join('pkg', 'index.js'), `import log from '@nitra/pino'\nlog.info('start')\n`, 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('configmap з OTEL_RESOURCE_ATTRIBUTES — OK', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'r',
        private: true,
        workspaces: ['svc']
      })
      await mkdir(join('svc', 'k8s', 'base'), { recursive: true })
      await writeJson(join('svc', 'package.json'), { name: 'svc' })
      await writeFile(
        join('svc', 'k8s', 'base', 'configmap.yaml'),
        `data:\n  OTEL_RESOURCE_ATTRIBUTES: 'service.name=svc,service.namespace=default'\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })
})
