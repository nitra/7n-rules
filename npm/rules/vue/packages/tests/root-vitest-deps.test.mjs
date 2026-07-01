/**
 * Тести для перевірки кореневих vitest-залежностей у Vue-монорепо (vue.mdc testing).
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { lint } from '../main.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const check = async dir => {
  const { violations } = await lint({
    cwd: dir,
    ruleId: 'vue',
    concernId: 'packages',
    files: undefined
  })
  return violations.length > 0 ? 1 : 0
}

const VALID_ROOT_DEVDEPS = {
  vitest: '^3.0.0',
  '@vitest/coverage-v8': '^3.0.0',
  '@stryker-mutator/vitest-runner': '^9.0.0'
}

const VALID_VUE_PKG = {
  name: 'site',
  dependencies: { vue: '^3.5.0' },
  devDependencies: {
    vite: '^8.0.0',
    '@vitejs/plugin-vue': '^6.0.0',
    'vue-macros': '^3.0.0',
    'unplugin-auto-import': '^20.0.0',
    'vite-plugin-vue-layouts-next': '^1.0.0',
    lightningcss: '^1.0.0'
  }
}

/**
 *
 */
async function writeMinimalVueMonorepo(dir, rootDevDeps = VALID_ROOT_DEVDEPS) {
  await writeJson(join(dir, 'package.json'), {
    name: 'root',
    private: true,
    workspaces: ['site'],
    devDependencies: rootDevDeps
  })
  await mkdir(join(dir, 'site', 'src'), { recursive: true })
  await writeJson(join(dir, 'site', 'package.json'), VALID_VUE_PKG)
  await writeJson(join(dir, 'site', 'jsconfig.json'), {
    compilerOptions: { moduleResolution: 'NodeNext' },
    include: ['src/**/*']
  })
  // Мінімальний vite.config.js з VueMacros + AutoImport (vue в imports)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    join(dir, 'site', 'vite.config.js'),
    [
      `import { defineConfig } from 'vite'`,
      `import VueMacros from 'vue-macros/vite'`,
      `import AutoImport from 'unplugin-auto-import/vite'`,
      `export default defineConfig({ css: { transformer: 'lightningcss' }, plugins: [VueMacros(), AutoImport({ imports: ['vue'] })] })`,
      ``
    ].join('\n'),
    'utf8'
  )
  await writeFile(join(dir, 'site', 'src', 'vite-env.d.ts'), `/// <reference types="vite/client" />\n`, 'utf8')
  await mkdir(join(dir, '.vscode'), { recursive: true })
  await writeJson(join(dir, '.vscode', 'extensions.json'), { recommendations: ['Vue.volar'] })
}

describe('checkRootVitestDevDeps via check()', () => {
  test('0, якщо root devDeps містить усі vitest-пакети', async () => {
    await withTmpDir(async dir => {
      await writeMinimalVueMonorepo(dir)
      const code = await check(dir)
      expect(code).toBe(0)
    })
  })

  test('1, якщо root devDeps не містить vitest', async () => {
    await withTmpDir(async dir => {
      const { vitest: _, ...rest } = VALID_ROOT_DEVDEPS
      await writeMinimalVueMonorepo(dir, rest)
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })

  test('1, якщо root devDeps не містить @vitest/coverage-v8', async () => {
    await withTmpDir(async dir => {
      const { '@vitest/coverage-v8': _, ...rest } = VALID_ROOT_DEVDEPS
      await writeMinimalVueMonorepo(dir, rest)
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })

  test('1, якщо root devDeps не містить @stryker-mutator/vitest-runner', async () => {
    await withTmpDir(async dir => {
      const { '@stryker-mutator/vitest-runner': _, ...rest } = VALID_ROOT_DEVDEPS
      await writeMinimalVueMonorepo(dir, rest)
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })

  test('0, якщо немає vue-пакетів — perевірку пропущено', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', private: true, workspaces: ['lib'] })
      await mkdir(join(dir, 'lib'), { recursive: true })
      await writeJson(join(dir, 'lib', 'package.json'), { name: 'lib', dependencies: { react: '^18.0.0' } })
      const code = await check(dir)
      expect(code).toBe(0)
    })
  })
})
