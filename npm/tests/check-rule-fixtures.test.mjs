/**
 * Тести check-vue, check-style, check-nginx у штучних мінімальних проєктах (у репозиторії cursor ці правила не повністю застосовані).
 */
import { describe, expect, test } from 'vitest'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lint as lintNginx } from '../rules/nginx-default-tpl/template/main.mjs'
import { lint as lintStyle } from '../rules/style/tooling/main.mjs'
import { lint as lintVue } from '../rules/vue/packages/main.mjs'
import { ensureDir, withTmpDir, writeJson } from '../scripts/utils/test-helpers.mjs'

// Адаптери під unified lint surface: detector → 0 (чисто) / 1 (є violations).
const checkNginx = async dir => {
  const result = await lintNginx({ cwd: dir, ruleId: 'nginx-default-tpl', concernId: 'template' })
  return result.violations.length === 0 ? 0 : 1
}
const checkStyle = async dir => {
  const result = await lintStyle({ cwd: dir, ruleId: 'style', concernId: 'tooling' })
  return result.violations.length === 0 ? 0 : 1
}
const checkVue = async dir => {
  const result = await lintVue({ cwd: dir, ruleId: 'vue', concernId: 'packages' })
  return result.violations.length === 0 ? 0 : 1
}

const nginxFixDir = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'rules/nginx-default-tpl/template/tests/fixtures'
)

/**
 * Готує мінімальний monorepo з workspace-пакетом `app` (Vue + Vite) для `check-vue`.
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @param {{ forbiddenVueImport?: boolean }} [opts] якщо `forbiddenVueImport` — додає `src/bad.ts` з забороненим імпортом
 * @returns {Promise<void>}
 */
async function setupMinimalVueAppWorkspace(dir, opts = {}) {
  await ensureDir(join(dir, '.vscode'))
  await writeJson(join(dir, '.vscode/extensions.json'), {
    recommendations: ['Vue.volar']
  })
  await writeJson(join(dir, 'package.json'), {
    name: 'mono',
    private: true,
    workspaces: ['app'],
    devDependencies: {
      vitest: '^3.0.0',
      '@vitest/coverage-v8': '^3.0.0',
      '@stryker-mutator/vitest-runner': '^9.0.0'
    }
  })
  await ensureDir(join(dir, 'app'))
  await writeJson(join(dir, 'app', 'package.json'), {
    name: 'app',
    dependencies: { vue: '^3.6.12' },
    devDependencies: {
      vite: '^8.0.0',
      '@vitejs/plugin-vue': '^6.0.0',
      'vue-macros': '^3.0.0',
      'unplugin-auto-import': '^0.17.0',
      'vite-plugin-vue-layouts-next': '^1.0.0',
      lightningcss: '^1.0.0'
    }
  })
  await writeFile(
    join(dir, 'app', 'vite.config.js'),
    `import Vue from '@vitejs/plugin-vue'\nimport VueMacros from 'vue-macros/vite'\nimport AutoImport from 'unplugin-auto-import/vite'\nexport default {\n  css: { transformer: 'lightningcss' },\n  plugins: [VueMacros({ plugins: { vue: Vue() } }), AutoImport({ imports: ['vue'] })]\n}\n`,
    'utf8'
  )
  await ensureDir(join(dir, 'app', 'src'))
  await writeFile(join(dir, 'app', 'src', 'vite-env.d.ts'), `/// <reference types="vite/client" />\n`, 'utf8')
  await writeJson(join(dir, 'app', 'jsconfig.json'), {
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      jsx: 'preserve',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowJs: true
    },
    include: ['src/**/*']
  })
  if (opts.forbiddenVueImport) {
    await writeFile(join(dir, 'app', 'src', 'bad.ts'), `import { ref } from 'vue'\n`, 'utf8')
  }
}

describe('check-vue (мінімальний проєкт)', () => {
  test('проходить для мінімального Vue-пакета в workspace', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      expect(await checkVue(dir)).toBe(0)
    })
  })

  test('помилка: явний value-імпорт з vue у джерелі пакета', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir, { forbiddenVueImport: true })
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('помилка: немає src/vite-env.d.ts з reference на vite/client', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      const { unlink } = await import('node:fs/promises')
      await unlink(join(dir, 'app', 'src', 'vite-env.d.ts'))
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('помилка: AutoImport є, але `vue` не у його imports (видалити value-імпорти небезпечно)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(
        join(dir, 'app', 'vite.config.js'),
        `import Vue from '@vitejs/plugin-vue'\nimport VueMacros from 'vue-macros/vite'\nimport AutoImport from 'unplugin-auto-import/vite'\nexport default {\n  plugins: [VueMacros({ plugins: { vue: Vue() } }), AutoImport({ imports: ['pinia'] })]\n}\n`,
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('AutoImport без `vue` → value-імпорти з `vue` не оголошуються забороненими', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir, { forbiddenVueImport: true })
      await writeFile(
        join(dir, 'app', 'vite.config.js'),
        `import Vue from '@vitejs/plugin-vue'\nimport VueMacros from 'vue-macros/vite'\nimport AutoImport from 'unplugin-auto-import/vite'\nexport default {\n  plugins: [VueMacros({ plugins: { vue: Vue() } }), AutoImport({ imports: ['pinia'] })]\n}\n`,
        'utf8'
      )
      const exit = await checkVue(dir)
      const sourceContent = await readFile(join(dir, 'app', 'src', 'bad.ts'), 'utf8')
      expect(exit).toBe(1)
      expect(sourceContent.includes("from 'vue'")).toBe(true)
    })
  })

  test('помилка: імпорт Node-нативного модуля у .vue SFC', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await ensureDir(join(dir, 'app', 'src'))
      await writeFile(
        join(dir, 'app', 'src', 'NBad.vue'),
        `<template><div /></template>\n<script setup lang="ts">\nimport { setTimeout as sleep } from 'node:timers/promises'\nawait sleep(1)\n</script>\n`,
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('помилка: bare-built-in (fs) у .vue SFC', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await ensureDir(join(dir, 'app', 'src'))
      await writeFile(
        join(dir, 'app', 'src', 'NBad.vue'),
        `<template><div /></template>\n<script setup>\nimport fs from 'fs'\nfs.readFileSync\n</script>\n`,
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })
})

describe('check-style (мінімальний проєкт)', () => {
  test('проходить при повному мінімальному наборі файлів', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 's',
        private: true,
        scripts: { 'lint-style': `npx stylelint '**/*.css' --fix` },
        devDependencies: { '@nitra/stylelint-config': '^1.4.0' },
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(
        join(dir, '.github/workflows', 'lint-style.yml'),
        'name: S\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx stylelint\n',
        'utf8'
      )
      await ensureDir(join(dir, '.vscode'))
      await writeJson(join(dir, '.vscode/extensions.json'), {
        recommendations: ['stylelint.vscode-stylelint']
      })
      await writeJson(join(dir, '.vscode/settings.json'), {
        'css.validate': false,
        'less.validate': false,
        'scss.validate': false
      })
      expect(await checkStyle(dir)).toBe(0)
    })
  })
})

describe('check-nginx-default-tpl (мінімальний проєкт)', () => {
  test('проходить з шаблоном і налаштуваннями VSCode', async () => {
    await withTmpDir(async dir => {
      await copyFile(join(nginxFixDir, 'default.conf.template'), join(dir, 'default.conf.template'))
      await copyFile(join(nginxFixDir, 'values-dev.ini'), join(dir, 'values-dev.ini'))
      await writeFile(
        join(dir, 'Dockerfile'),
        [
          'FROM nginx:alpine-slim',
          "RUN find /usr/share/nginx/html -type f -name '*.js' -exec gzip -k {} +",
          'RUN envsubst "$VARS" < /tpl/default.conf.template > /app/default.conf',
          ''
        ].join('\n'),
        'utf8'
      )
      await ensureDir(join(dir, '.vscode'))
      await writeJson(join(dir, '.vscode/extensions.json'), {
        recommendations: ['ahmadalli.vscode-nginx-conf']
      })
      await writeJson(join(dir, '.vscode/settings.json'), {
        'editor.formatOnSave': true,
        '[nginx]': { 'editor.defaultFormatter': 'ahmadalli.vscode-nginx-conf' }
      })
      expect(await checkNginx(dir)).toBe(0)
    })
  })

  test('0 — немає default.conf.template → перевірку пропущено', async () => {
    await withTmpDir(async dir => {
      expect(await checkNginx(dir)).toBe(0)
    })
  })

  test('1 — є шаблон, немає *.ini і Dockerfile', async () => {
    await withTmpDir(async dir => {
      await copyFile(join(nginxFixDir, 'default.conf.template'), join(dir, 'default.conf.template'))
      expect(await checkNginx(dir)).toBe(1)
    })
  })

  test('1 — шаблон + ini + Dockerfile без gzip і envsubst', async () => {
    await withTmpDir(async dir => {
      await copyFile(join(nginxFixDir, 'default.conf.template'), join(dir, 'default.conf.template'))
      await copyFile(join(nginxFixDir, 'values-dev.ini'), join(dir, 'values-dev.ini'))
      await writeFile(join(dir, 'Dockerfile'), 'FROM nginx:alpine\n', 'utf8')
      expect(await checkNginx(dir)).toBe(1)
    })
  })
})

describe('check-vue: додаткові сценарії', () => {
  test('0 — без vue-пакетів (жодного vue у dependencies)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'mono', private: true })
      expect(await checkVue(dir)).toBe(0)
    })
  })

  test('1 — немає vite.config у пакеті', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      const { unlink } = await import('node:fs/promises')
      await unlink(join(dir, 'app', 'vite.config.js'))
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — process.env.npm_lifecycle_event у vite.config', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(
        join(dir, 'app', 'vite.config.js'),
        [
          `import Vue from '@vitejs/plugin-vue'`,
          `import VueMacros from 'vue-macros/vite'`,
          `import AutoImport from 'unplugin-auto-import/vite'`,
          `const isServe = process.env.npm_lifecycle_event === 'dev'`,
          `export default { plugins: [VueMacros({ plugins: { vue: Vue() } }), AutoImport({ imports: ['vue'] })] }`,
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — vite-env.d.ts без /// <reference types="vite/client" />', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(join(dir, 'app', 'src', 'vite-env.d.ts'), 'declare module "*.vue" {}\n', 'utf8')
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — немає jsconfig.json у пакеті', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      const { unlink } = await import('node:fs/promises')
      await unlink(join(dir, 'app', 'jsconfig.json'))
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — extensions.json без Vue.volar', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeJson(join(dir, '.vscode/extensions.json'), { recommendations: [] })
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — немає .vscode/extensions.json (lines 466-467)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      const { unlink } = await import('node:fs/promises')
      await unlink(join(dir, '.vscode/extensions.json'))
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — esbuild у файлі джерела пакета (lines 96-100, 119, 154-155)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(join(dir, 'app', 'bundler.mjs'), '// esbuild plugin\nexport default {}\n', 'utf8')
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — esbuild у vite.config (line 284)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(
        join(dir, 'app', 'vite.config.js'),
        [
          `import Vue from '@vitejs/plugin-vue'`,
          `import VueMacros from 'vue-macros/vite'`,
          `import AutoImport from 'unplugin-auto-import/vite'`,
          `// esbuild is forbidden`,
          `export default { plugins: [VueMacros({ plugins: { vue: Vue() } }), AutoImport({ imports: ['vue'] })] }`,
          ''
        ].join('\n'),
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('1 — vite.config без VueMacros і AutoImport → fail (line 294)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(
        join(dir, 'app', 'vite.config.js'),
        `import Vue from '@vitejs/plugin-vue'\nexport default { plugins: [Vue()] }\n`,
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('extractAutoImportCallArgs → null для незбалансованих дужок (line 250)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(
        join(dir, 'app', 'vite.config.js'),
        `import VueMacros from 'vue-macros/vite'\nimport AutoImport from 'unplugin-auto-import/vite'\nexport default { plugins: [VueMacros(), AutoImport({ imports: ['vue'\n`,
        'utf8'
      )
      expect(await checkVue(dir)).toBe(1)
    })
  })

  test('isEsbuildScanFile — файл у build/ → false (lines 51, 58)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await ensureDir(join(dir, 'app', 'build'))
      await writeFile(join(dir, 'app', 'build', 'out.js'), 'const x = 1\n', 'utf8')
      expect(typeof (await checkVue(dir))).toBe('number')
    })
  })

  test('isEsbuildScanFile — bun.lock → false (line 69)', async () => {
    await withTmpDir(async dir => {
      await setupMinimalVueAppWorkspace(dir)
      await writeFile(join(dir, 'app', 'bun.lock'), 'lockfileVersion 0\n', 'utf8')
      expect(typeof (await checkVue(dir))).toBe('number')
    })
  })
})
