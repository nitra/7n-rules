/**
 * Тести check-vue, check-style-lint, check-nginx у штучних мінімальних проєктах (у репозиторії cursor ці правила не повністю застосовані).
 */
import { describe, expect, test } from 'bun:test'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check as checkNginx } from '../scripts/check-nginx-default-tpl.mjs'
import { check as checkStyle } from '../scripts/check-style-lint.mjs'
import { check as checkVue } from '../scripts/check-vue.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

const nginxFixDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/nginx-default-tpl')

describe('check-vue (мінімальний проєкт)', () => {
  test('проходить для мінімального Vue-пакета в workspace', async () => {
    await withTmpCwd(async () => {
      await ensureDir('.vscode')
      await writeJson('.vscode/extensions.json', {
        recommendations: ['Vue.volar']
      })
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await ensureDir('app')
      await writeJson(join('app', 'package.json'), {
        name: 'app',
        dependencies: { vue: '^3.5.0' },
        devDependencies: {
          vite: '^8.0.0',
          '@vitejs/plugin-vue': '^6.0.0',
          'vue-macros': '^3.0.0',
          'unplugin-auto-import': '^0.17.0',
          'vite-plugin-vue-layouts-next': '^1.0.0'
        }
      })
      await writeFile(
        join('app', 'vite.config.js'),
        `import Vue from '@vitejs/plugin-vue'\n// VueMacros\n// AutoImport\nexport default { plugins: [Vue()] }\n`,
        'utf8'
      )
      expect(await checkVue()).toBe(0)
    })
  })
})

describe('check-style-lint (мінімальний проєкт)', () => {
  test('проходить при повному мінімальному наборі файлів', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 's',
        private: true,
        scripts: { 'lint-style': `stylelint '**/*.css' --fix` },
        devDependencies: { '@nitra/stylelint-config': '^1.4.0' },
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await writeFile('.stylelintignore', 'dist/\n', 'utf8')
      await ensureDir('.github/workflows')
      await writeFile(
        join('.github/workflows', 'lint-style.yml'),
        'name: S\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx stylelint\n',
        'utf8'
      )
      await ensureDir('.vscode')
      await writeJson('.vscode/extensions.json', {
        recommendations: ['stylelint.vscode-stylelint']
      })
      await writeJson('.vscode/settings.json', {
        'css.validate': false,
        'scss.validate': false
      })
      expect(await checkStyle()).toBe(0)
    })
  })
})

describe('check-nginx-default-tpl (мінімальний проєкт)', () => {
  test('проходить з шаблоном і налаштуваннями VSCode', async () => {
    await withTmpCwd(async () => {
      await copyFile(join(nginxFixDir, 'default.conf.template'), 'default.conf.template')
      await copyFile(join(nginxFixDir, 'values-dev.ini'), 'values-dev.ini')
      await writeFile(
        'Dockerfile',
        [
          'FROM nginx:alpine',
          "RUN find /usr/share/nginx/html -type f -name '*.js' -exec gzip -k {} +",
          'RUN envsubst "$VARS" < /tpl/default.conf.template > /app/default.conf',
          ''
        ].join('\n'),
        'utf8'
      )
      await ensureDir('.vscode')
      await writeJson('.vscode/extensions.json', {
        recommendations: ['ahmadalli.vscode-nginx-conf']
      })
      await writeJson('.vscode/settings.json', {
        'editor.formatOnSave': true,
        '[nginx]': { 'editor.defaultFormatter': 'ahmadalli.vscode-nginx-conf' }
      })
      expect(await checkNginx()).toBe(0)
    })
  })
})
