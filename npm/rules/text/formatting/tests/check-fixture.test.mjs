/**
 * Мінімальний тестовий каталог для check-text (oxfmt, cspell, markdownlint-cli2 через bunx у lint-text, v8r).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main as check } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

describe('check-text (мінімальний проєкт)', () => {
  test('проходить при повному мінімальному наборі', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.v8rignore'),
        `.vscode/extensions.json
.vscode/settings.json
`,
        'utf8'
      )
      await ensureDir(join(dir, '.vscode'))
      await writeJson(join(dir, '.vscode/extensions.json'), {
        recommendations: ['DavidAnson.vscode-markdownlint', 'oxc.oxc-vscode', 'timonwong.shellcheck']
      })
      const oxfmtBlock = Object.fromEntries(
        ['css', 'html', 'javascript', 'json', 'typescript', 'vue'].map(lang => [
          `[${lang}]`,
          { 'editor.defaultFormatter': 'oxc.oxc-vscode' }
        ])
      )
      await writeJson(join(dir, '.vscode/settings.json'), {
        'editor.formatOnSave': true,
        ...oxfmtBlock
      })
      await writeJson(join(dir, '.oxfmtrc.json'), {
        ignorePatterns: ['**/hasura/metadata/**', '**/schema.graphql', '**/auto-imports.d.ts'],
        arrowParens: 'avoid',
        printWidth: 120,
        bracketSpacing: true,
        bracketSameLine: true,
        semi: false,
        singleQuote: true,
        tabWidth: 2,
        trailingComma: 'none',
        useTabs: false
      })
      await writeJson(join(dir, '.markdownlint-cli2.jsonc'), {
        gitignore: true,
        config: { default: true, MD013: false }
      })
      await writeJson(join(dir, '.cspell.json'), {
        version: '0.2',
        language: 'en,nitra',
        ignorePaths: [
          '**/node_modules/**',
          '**/vscode-extension/**',
          '**/.git/**',
          '.vscode',
          'report',
          '*.svg',
          '**/k8s/**/*.yaml'
        ],
        import: ['@nitra/cspell-dict/cspell-ext.json'],
        words: []
      })
      const u2019 = '’'
      await ensureDir(join(dir, '.cursor/rules'))
      await writeFile(
        join(dir, '.cursor/rules', 'n-text.mdc'),
        `---
description: test
---
**Український апостроф:** U+0027 та U+2019; у прикладі символ ${u2019}
`,
        'utf8'
      )
      await writeJson(join(dir, 'package.json'), {
        name: 'text-fixture',
        private: true,
        devDependencies: {
          '@nitra/cspell-dict': '^2.0.0'
        }
      })
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(
        join(dir, '.github/workflows', 'lint-text.yml'),
        'name: T\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: n-cursor lint text --read-only\n',
        'utf8'
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('exit 1 — .v8rignore відсутній', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(1)
    })
  })

  test("exit 1 — .v8rignore без обов'язкових шляхів", async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.v8rignore'), '# empty\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 1 — .v8rignore з одним шляхом з двох', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.v8rignore'), '.vscode/extensions.json\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 1 — config файли відсутні (.oxfmtrc.json)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.v8rignore'), '.vscode/extensions.json\n.vscode/settings.json\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 1 — n-text.mdc без заголовку апострофу', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.v8rignore'), '.vscode/extensions.json\n.vscode/settings.json\n', 'utf8')
      await ensureDir(join(dir, '.cursor/rules'))
      await writeFile(join(dir, '.cursor/rules/n-text.mdc'), '# text\nno apostrophe paragraph here\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 1 — n-text.mdc з заголовком але без U+0027/U+2019', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.v8rignore'), '.vscode/extensions.json\n.vscode/settings.json\n', 'utf8')
      await ensureDir(join(dir, '.cursor/rules'))
      await writeFile(join(dir, '.cursor/rules/n-text.mdc'), '**Український апостроф:** без кодових позначок\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 1 — n-text.mdc з заголовком і кодами але без символу ’', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.v8rignore'), '.vscode/extensions.json\n.vscode/settings.json\n', 'utf8')
      await ensureDir(join(dir, '.cursor/rules'))
      await writeFile(
        join(dir, '.cursor/rules/n-text.mdc'),
        '**Український апостроф:** U+0027 та U+2019 — без самого символу\n',
        'utf8'
      )
      expect(await check(dir)).toBe(1)
    })
  })
})
