import { getConfig } from '@nitra/eslint-config'
import globals from 'globals'

// getConfig({ node: ['npm'] }) у @nitra/eslint-config задає Node globals лише для glob `npm/**/*.js` (не .mjs/.cjs).
// Для npm/**/*.mjs і npm/**/*.cjs додаємо globals.node окремо, інакше no-undef на process і console.
export default [
  {
    ignores: [
      '**/auto-imports.d.ts',
      'docs/**',
      '.claude/worktrees/**',
      // Згенеровані артефакти (gitignored): coverage report і Stryker mutation sandbox/output.
      '**/coverage/**',
      '**/reports/stryker/**',
      // Згенерований coverage-звіт у markdown — містить JS-snippets, які лінтер ловить як код.
      'COVERAGE.md',
      '**/COVERAGE.md'
    ]
  },
  ...getConfig({
    node: ['npm'],
    vue: ['demo']
  }),
  {
    files: ['npm/**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  // npm-module rule забороняє devDependencies у npm/package.json (compact published
  // tarball), тож vitest stack живе у кореневому package.json і визначається через
  // bun hoisted node_modules. `n/no-extraneous-import` цього не бачить — allowModules
  // ставить exception лише для канонічного vitest-runner baseline (test.mdc).
  {
    files: ['npm/**/*.{js,mjs,cjs}'],
    rules: {
      'n/no-extraneous-import': [
        'error',
        { allowModules: ['vitest', '@vitest/coverage-v8', '@stryker-mutator/vitest-runner'] }
      ]
    }
  }
]
