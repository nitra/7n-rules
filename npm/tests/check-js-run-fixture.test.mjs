/**
 * Тести check-js-run на workspace-пакетах.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../scripts/check-js-run.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

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
      await writeJson(join('pkg', 'jsconfig.json'), CANONICAL_BACKEND_JSCONFIG)
      await writeFile(
        join('pkg', 'src', 'conn', 'pg.js'),
        `import { checkEnv, env } from '@nitra/check-env'\nimport { SQL } from 'bun'\ncheckEnv(['PG_CONN'])\nexport const db = new SQL({ url: env.PG_CONN })\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('1, якщо є src/ у backend-пакеті, але немає jsconfig.json', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await mkdir(join('pkg', 'src'), { recursive: true })
      await writeFile(join('pkg', 'src', 'app.js'), `export const x = 1\n`, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('1, якщо jsconfig.json не збігається з каноном js-run', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await mkdir(join('pkg', 'src'), { recursive: true })
      await writeFile(join('pkg', 'src', 'app.js'), `export const x = 1\n`, 'utf8')
      await writeJson(join('pkg', 'jsconfig.json'), {
        compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', target: 'esnext' },
        include: ['src/**/*']
      })
      expect(await check()).toBe(1)
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
      await writeFile(join('site', 'src', 'main.js'), `const env = process.env.NODE_ENV\nconsole.log(env)\n`, 'utf8')
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

  test('1, якщо у workspace-пакеті є await new Promise(r => setTimeout(r, ms))', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `export async function pause() {\n  await new Promise(resolve => setTimeout(resolve, 500))\n}\n`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test("0, якщо паузу зроблено через setTimeout з 'node:timers/promises'", async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      await writeFile(
        join('pkg', 'index.js'),
        `import { setTimeout } from 'node:timers/promises'\n\nexport async function pause() {\n  await setTimeout(500)\n}\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })
})

/**
 * Підготовка монорепо з одним workspace-пакетом `cron-jobs/foo` (без vite/bunyan/conn-проблем)
 * і workflow-файлом за заданою назвою/вмістом.
 * @param {string} workflowName ім'я файлу всередині `.github/workflows/`
 * @param {string} workflowContent YAML-вміст workflow
 * @returns {Promise<void>}
 */
async function writeRepoWithCronJobAndWorkflow(workflowName, workflowContent) {
  await writeJson('package.json', {
    name: 'r',
    private: true,
    workspaces: ['cron-jobs/foo']
  })
  await ensureDir(join('cron-jobs', 'foo'))
  await writeJson(join('cron-jobs', 'foo', 'package.json'), {
    name: 'foo',
    dependencies: { '@nitra/pino': '^1.0.0' }
  })
  await mkdir(join('.github', 'workflows'), { recursive: true })
  await writeFile(join('.github', 'workflows', workflowName), workflowContent, 'utf8')
}

describe('check-js-run: depcheck у path-scoped workflow', () => {
  test('0, якщо нема .github/workflows', async () => {
    await withTmpCwd(async () => {
      await writeRootWithWorkspacePkg({ '@nitra/pino': '^1.0.0' })
      expect(await check()).toBe(0)
    })
  })

  test('0, якщо workflow без paths: (глобальний lint)', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'lint-js.yml',
        `name: Lint JS\non:\n  push:\n    branches: [main]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`
      )
      expect(await check()).toBe(0)
    })
  })

  test('0, якщо paths глобальні (**/*.js, не зачіпає конкретний пакет)', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'lint-js.yml',
        `name: Lint JS\non:\n  push:\n    paths:\n      - '**/*.js'\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`
      )
      expect(await check()).toBe(0)
    })
  })

  test('1, якщо paths обмежено пакетом, але немає кроку depcheck', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'foo.yml',
        `name: foo\non:\n  push:\n    paths:\n      - 'cron-jobs/foo/**'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n`
      )
      expect(await check()).toBe(1)
    })
  })

  test('1, якщо depcheck є, але working-directory неправильна', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'foo.yml',
        `name: foo\non:\n  push:\n    paths:\n      - 'cron-jobs/foo/**'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx depcheck --ignores="graphql,bun"\n        working-directory: cron-jobs/bar\n`
      )
      expect(await check()).toBe(1)
    })
  })

  test('1, якщо depcheck без --ignores', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'foo.yml',
        `name: foo\non:\n  push:\n    paths:\n      - 'cron-jobs/foo/**'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx depcheck\n        working-directory: cron-jobs/foo\n`
      )
      expect(await check()).toBe(1)
    })
  })

  test('1, якщо --ignores не містить bun', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'foo.yml',
        `name: foo\non:\n  push:\n    paths:\n      - 'cron-jobs/foo/**'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx depcheck --ignores="graphql"\n        working-directory: cron-jobs/foo\n`
      )
      expect(await check()).toBe(1)
    })
  })

  test('0, якщо depcheck коректний (graphql,bun у будь-якому порядку, з extra)', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'foo.yml',
        `name: foo\non:\n  push:\n    paths:\n      - 'cron-jobs/foo/**'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx depcheck --ignores="bun,extra,graphql"\n        working-directory: cron-jobs/foo\n`
      )
      expect(await check()).toBe(0)
    })
  })

  test('0, якщо paths цілить вкладений каталог пакета (cron-jobs/foo/src/**)', async () => {
    await withTmpCwd(async () => {
      await writeRepoWithCronJobAndWorkflow(
        'foo.yml',
        `name: foo\non:\n  push:\n    paths:\n      - 'cron-jobs/foo/src/**'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx depcheck --ignores="graphql,bun"\n        working-directory: cron-jobs/foo\n`
      )
      expect(await check()).toBe(0)
    })
  })
})
