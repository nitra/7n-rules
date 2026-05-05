/**
 * Тести check-js-run на workspace-пакетах.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../scripts/check-js-run.mjs'
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

describe('check-js-run (мінімальний проєкт)', () => {
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

  test("1, якщо import { SQL } from 'bun' поза src/conn/", async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `import { SQL } from 'bun'\nimport { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['PG_CONN'])\nexport const db = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test("0, якщо import { SQL } from 'bun' у src/conn/", async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await mkdir(join('pkg', 'src', 'conn'), { recursive: true })
      await writeFile(
        join('pkg', 'src', 'conn', 'pg.js'),
        `import { checkEnv, env } from '@nitra/check-env'\nimport { SQL } from 'bun'\ncheckEnv(['PG_CONN'])\nexport const db = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test("враховує package.json#imports['#conn/*']", async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'r', private: true, workspaces: ['pkg'] })
      await ensureDir('pkg')
      await writeJson(join('pkg', 'package.json'), {
        name: 'pkg',
        dependencies: { '@nitra/pino': '^1.0.0' },
        imports: { '#conn/*': './lib/connections/*' }
      })
      await mkdir(join('pkg', 'lib', 'connections'), { recursive: true })
      await writeFile(
        join('pkg', 'lib', 'connections', 'pg.js'),
        `import { checkEnv, env } from '@nitra/check-env'\nimport { SQL } from 'bun'\ncheckEnv(['PG_CONN'])\nexport const db = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('1, якщо у workspace використано пряме process.env.X (треба замінити на env)', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(join('pkg', 'index.js'), `console.log(process.env.SECRET)\n`, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('0, якщо у workspace-пакеті є vite у devDependencies — js-run пропущено для нього', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'r',
        private: true,
        workspaces: ['site']
      })
      await ensureDir('site')
      await writeJson(join('site', 'package.json'), {
        name: 'site',
        dependencies: {},
        devDependencies: { vite: '^8.0.0' }
      })
      await mkdir(join('site', 'src'), { recursive: true })
      await writeFile(
        join('site', 'src', 'main.js'),
        `const env = process.env.NODE_ENV\nconsole.log(env)\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('1, якщо у workspace-пакеті без vite є пряме process.env.X', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(join('pkg', 'index.js'), `console.log(process.env.PG_CONN)\n`, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test("1, якщо process.env.X закрите checkEnv — все одно треба замінити на env з '@nitra/check-env'", async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `import { checkEnv } from '@nitra/check-env'\ncheckEnv(['SECRET'])\nconsole.log(process.env.SECRET)\n`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test("0, якщо обов'язкова env прийшла з '@nitra/check-env' з checkEnv", async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `import { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['SECRET'])\nconsole.log(env.SECRET)\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test("0, якщо опційна env прийшла з 'node:process'", async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `import { env } from 'node:process'\nconsole.log(env.OPTIONAL)\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('0, якщо процесний доступ закритий ignore-коментарем (escape-hatch)', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `// @nitra/cursor ignore-next-line checkEnv\nconsole.log(process.env.OPTIONAL)\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })
})
