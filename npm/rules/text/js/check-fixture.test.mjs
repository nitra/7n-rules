/**
 * Мінімальний тестовий каталог для check-text (oxfmt, cspell, markdownlint-cli2 через bunx у lint-text, v8r).
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from './check.mjs'
import { ensureDir, withTmpCwd, writeJson } from '../../../scripts/utils/test-helpers.mjs'

describe('check-text (мінімальний проєкт)', () => {
  test('проходить при повному мінімальному наборі', async () => {
    await withTmpCwd(async () => {
      await writeFile(
        '.v8rignore',
        `.vscode/extensions.json
.vscode/settings.json
`,
        'utf8'
      )
      await ensureDir('.vscode')
      await writeJson('.vscode/extensions.json', {
        recommendations: ['DavidAnson.vscode-markdownlint', 'oxc.oxc-vscode', 'timonwong.shellcheck']
      })
      const oxfmtBlock = Object.fromEntries(
        ['css', 'html', 'javascript', 'json', 'typescript', 'vue'].map(lang => [
          `[${lang}]`,
          { 'editor.defaultFormatter': 'oxc.oxc-vscode' }
        ])
      )
      await writeJson('.vscode/settings.json', {
        'editor.formatOnSave': true,
        ...oxfmtBlock
      })
      await writeJson('.oxfmtrc.json', {
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
      await writeJson('.markdownlint-cli2.jsonc', {
        gitignore: true,
        config: { default: true, MD013: false }
      })
      await writeJson('.cspell.json', {
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
      const u2019 = '\u2019'
      await ensureDir('.cursor/rules')
      await writeFile(
        join('.cursor/rules', 'n-text.mdc'),
        `---
description: test
---
**Український апостроф:** U+0027 та U+2019; у прикладі символ ${u2019}
`,
        'utf8'
      )
      await writeJson('package.json', {
        name: 'text-fixture',
        private: true,
        devDependencies: {
          '@nitra/cspell-dict': '^2.0.0'
        },
        scripts: {
          'lint-text':
            'npx cspell . && bun ./npm/scripts/run-shellcheck-text.mjs && bunx markdownlint-cli2 --fix "**/*.md" "**/*.mdc" && bun ./npm/scripts/run-v8r.mjs'
        }
      })
      await ensureDir('.github/workflows')
      await writeFile(
        join('.github/workflows', 'lint-text.yml'),
        'name: T\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint-text\n',
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })
})
