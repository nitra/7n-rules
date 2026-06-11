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
      // git-worktree чекаути (gitignored): повні копії репо + handoff-доки, не лінтимо.
      '.worktrees/**',
      // Згенеровані артефакти (gitignored): coverage report і Stryker mutation sandbox/output.
      '**/coverage/**',
      '**/reports/stryker/**',
      // Згенерований coverage-звіт у markdown — містить JS-snippets, які лінтер ловить як код.
      'COVERAGE.md',
      '**/COVERAGE.md',
      // Згенеровані doc-files доки (<dir>/docs/<stem>.md) — ілюстративні snippets, не runnable-код.
      '**/docs/*.md'
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
  },
  // SIGINT/SIGTERM-хендлер: process.exit(130) — POSIX-конвенція для "killed by signal".
  {
    files: ['npm/scripts/utils/with-lock.mjs'],
    rules: {
      'n/no-process-exit': 'off'
    }
  },
  // Динамічний import() від шляху з readdirSync-whitelist'у (не від user input).
  {
    files: [
      'npm/scripts/lint-cli.mjs',
      'npm/scripts/lib/run-rule.mjs',
      'npm/tests/fix-mjs-contract.test.mjs',
      'npm/rules/test/coverage/coverage.mjs'
    ],
    rules: {
      'no-unsanitized/method': 'off'
    }
  },
  // k8s: відомі GCP-GCLB та RFC-1918 IP-діапазони — не секрети, не user input (k8s.mdc).
  {
    files: ['npm/rules/k8s/js/manifests.mjs', 'npm/rules/k8s/js/tests/**/*.mjs'],
    rules: {
      'sonarjs/no-hardcoded-ip': 'off'
    }
  },
  // Hasura: кластерний endpoint мусить бути http:// (hasura.mdc визначає схему).
  {
    files: ['npm/rules/hasura/js/tests/**/*.mjs'],
    rules: {
      '@microsoft/sdl/no-insecure-url': 'off',
      'sonarjs/no-clear-text-protocols': 'off'
    }
  },
  // Semver-рядки в npm version range — короткі (< 100 символів), не ReDoS-загроза.
  {
    files: ['npm/rules/capacitor/js/platforms.mjs'],
    rules: {
      'sonarjs/slow-regex': 'off'
    }
  },
  // glob→RegExp з попередньо екранованим glob-pattern (REGEX_SPECIAL_IN_GLOB).
  {
    files: ['npm/rules/npm-module/js/package_structure.mjs'],
    rules: {
      'security/detect-non-literal-regexp': 'off'
    }
  }
]
