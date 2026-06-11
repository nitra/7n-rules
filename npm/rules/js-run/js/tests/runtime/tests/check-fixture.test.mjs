/**
 * Тести check-js-run на workspace-пакетах.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../../../runtime.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../../../scripts/utils/test-helpers.mjs'

/** Канонічний jsconfig для backend-пакетів із `src/` (js-run.mdc). */
const CANONICAL_BACKEND_JSCONFIG = {
  compilerOptions: {
    lib: ['esnext'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    target: 'esnext',
    checkJs: false
  },
  include: ['src/**/*']
}

/**
 * Monorepo `workspaces: ['pkg']` і мінімальний `pkg/package.json` з залежностями.
 * @param {string} dir абсолютний шлях тимчасової директорії
 * @param {Record<string, string>} pkgDependencies залежності workspace-пакета
 * @returns {Promise<void>} завершується після запису файлів
 */
async function writeRootWithWorkspacePkg(dir, pkgDependencies) {
  await writeJson(join(dir, 'package.json'), {
    name: 'r',
    private: true,
    workspaces: ['pkg']
  })
  await ensureDir(join(dir, 'pkg'))
  await writeJson(join(dir, 'pkg', 'package.json'), {
    name: 'pkg',
    dependencies: pkgDependencies
  })
}

describe('check-js-run (мінімальний проєкт)', () => {
  test('0, якщо немає workspace-пакетів окрім кореня', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'r', private: true })
      expect(await check(dir)).toBe(0)
    })
  })

  // `bunyan` / `@nitra/bunyan` у dependencies/devDependencies тепер у Rego
  // (`npm/policy/js_run/package_json/`); JS-перевірка через AST-скан коду лишилася.

  test.skip('1, якщо в workspace-пакеті є bunyan', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { bunyan: '^1.8.0' })
      expect(await check(dir)).toBe(1)
    })
  })

  test('1, якщо у джерелах workspace-пакета лишився import з @nitra/bunyan', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(join(dir, 'pkg', 'index.js'), `import log from '@nitra/bunyan'\nlog.info('start')\n`, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('0, якщо джерела використовують лише @nitra/pino', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(join(dir, 'pkg', 'index.js'), `import log from '@nitra/pino'\nlog.info('start')\n`, 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('configmap з OTEL_RESOURCE_ATTRIBUTES — OK', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'r',
        private: true,
        workspaces: ['svc']
      })
      await mkdir(join(dir, 'svc', 'k8s', 'base'), { recursive: true })
      await writeJson(join(dir, 'svc', 'package.json'), { name: 'svc' })
      await writeFile(
        join(dir, 'svc', 'k8s', 'base', 'configmap.yaml'),
        `data:\n  OTEL_RESOURCE_ATTRIBUTES: 'service.name=svc,service.namespace=default'\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("1, якщо import { SQL } from 'bun' поза src/conn/", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `import { SQL } from 'bun'\nimport { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['PG_CONN'])\nexport const db = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test("0, якщо import { SQL } from 'bun' у src/conn/", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await mkdir(join(dir, 'pkg', 'src', 'conn'), { recursive: true })
      await writeJson(join(dir, 'pkg', 'jsconfig.json'), CANONICAL_BACKEND_JSCONFIG)
      await writeFile(
        join(dir, 'pkg', 'src', 'conn', 'pg-write.mjs'),
        `import { checkEnv, env } from '@nitra/check-env'\nimport { SQL } from 'bun'\ncheckEnv(['PG_CONN'])\nexport const pgWrite = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("0, якщо src/conn/mssql-write.mjs з 'export const mssqlWrite'", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await mkdir(join(dir, 'pkg', 'src', 'conn'), { recursive: true })
      await writeJson(join(dir, 'pkg', 'jsconfig.json'), CANONICAL_BACKEND_JSCONFIG)
      await writeFile(
        join(dir, 'pkg', 'src', 'conn', 'mssql-write.mjs'),
        `import sql from 'mssql'\nexport const mssqlWrite = new sql.ConnectionPool({})\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('1, якщо src/conn/mssql-write.mjs експортує не mssqlWrite, а mssqlWriter', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await mkdir(join(dir, 'pkg', 'src', 'conn'), { recursive: true })
      await writeJson(join(dir, 'pkg', 'jsconfig.json'), CANONICAL_BACKEND_JSCONFIG)
      await writeFile(
        join(dir, 'pkg', 'src', 'conn', 'mssql-write.mjs'),
        `import sql from 'mssql'\nexport const mssqlWriter = new sql.ConnectionPool({})\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('1, якщо є src/ у backend-пакеті, але немає jsconfig.json', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await mkdir(join(dir, 'pkg', 'src'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'src', 'app.js'), `export const x = 1\n`, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  // Структуру `jsconfig.json` тепер валідує Rego (`npm/policy/js_run/jsconfig/`);
  // JS-перевірка лише наявність файлу.

  test.skip('1, якщо jsconfig.json не збігається з каноном js-run', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await mkdir(join(dir, 'pkg', 'src'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'src', 'app.js'), `export const x = 1\n`, 'utf8')
      await writeJson(join(dir, 'pkg', 'jsconfig.json'), {
        compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', target: 'esnext' },
        include: ['src/**/*']
      })
      expect(await check(dir)).toBe(1)
    })
  })

  test("враховує package.json#imports['#conn/*']", async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'r', private: true, workspaces: ['pkg'] })
      await ensureDir(join(dir, 'pkg'))
      await writeJson(join(dir, 'pkg', 'package.json'), {
        name: 'pkg',
        dependencies: { '@nitra/pino': '^1.0.0' },
        imports: { '#conn/*': './lib/connections/*' }
      })
      await mkdir(join(dir, 'pkg', 'lib', 'connections'), { recursive: true })
      await writeFile(
        join(dir, 'pkg', 'lib', 'connections', 'pg-write.mjs'),
        `import { checkEnv, env } from '@nitra/check-env'\nimport { SQL } from 'bun'\ncheckEnv(['PG_CONN'])\nexport const pgWrite = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('1, якщо у workspace використано пряме process.env.X (треба замінити на env)', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(join(dir, 'pkg', 'index.js'), `console.log(process.env.SECRET)\n`, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('0, якщо у workspace-пакеті є vite у devDependencies — js-run пропущено для нього', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'r',
        private: true,
        workspaces: ['site']
      })
      await ensureDir(join(dir, 'site'))
      await writeJson(join(dir, 'site', 'package.json'), {
        name: 'site',
        dependencies: {},
        devDependencies: { vite: '^8.0.0' }
      })
      await mkdir(join(dir, 'site', 'src'), { recursive: true })
      await writeFile(
        join(dir, 'site', 'src', 'main.js'),
        `const env = process.env.NODE_ENV\nconsole.log(env)\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('1, якщо у workspace-пакеті без vite є пряме process.env.X', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(join(dir, 'pkg', 'index.js'), `console.log(process.env.PG_CONN)\n`, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test("1, якщо process.env.X закрите checkEnv — все одно треба замінити на env з '@nitra/check-env'", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `import { checkEnv } from '@nitra/check-env'\ncheckEnv(['SECRET'])\nconsole.log(process.env.SECRET)\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test("0, якщо обов'язкова env прийшла з '@nitra/check-env' з checkEnv", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `import { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['SECRET'])\nconsole.log(env.SECRET)\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("0, якщо опційна env прийшла з 'node:process'", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `import { env } from 'node:process'\nconsole.log(env.OPTIONAL)\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('0, якщо процесний доступ закритий ignore-коментарем (escape-hatch)', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `// @nitra/cursor ignore-next-line checkEnv\nconsole.log(process.env.OPTIONAL)\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('1, якщо у workspace-пакеті є await new Promise(r => setTimeout(r, ms))', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `export async function pause() {\n  await new Promise(resolve => setTimeout(resolve, 500))\n}\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test("0, якщо паузу зроблено через setTimeout з 'node:timers/promises'", async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(
        join(dir, 'pkg', 'index.js'),
        `import { setTimeout } from 'node:timers/promises'\n\nexport async function pause() {\n  await setTimeout(500)\n}\n`,
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('1, якщо backend workspace використовує Temporal API', async () => {
    await withTmpDir(async dir => {
      await writeRootWithWorkspacePkg(dir, { '@nitra/pino': '^1.0.0' })
      await writeFile(join(dir, 'pkg', 'index.js'), `export const now = Temporal.Now.instant()\n`, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })
})
