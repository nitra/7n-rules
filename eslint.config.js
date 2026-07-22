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
      // локальні артефакти fix-движка (gitignored): trace/аналіз із JS-snippets, не runnable-код.
      '.n-cursor/**',
      // Згенеровані артефакти (gitignored): coverage report і Stryker mutation sandbox/output.
      '**/coverage/**',
      '**/reports/stryker/**',
      // Згенерований coverage-звіт у markdown — містить JS-snippets, які лінтер ловить як код.
      'COVERAGE.md',
      '**/COVERAGE.md',
      // Згенеровані doc-files доки (<dir>/docs/<stem>.md) — ілюстративні snippets, не runnable-код.
      '**/docs/*.md',
      // Синковані pi.dev TS-extensions (fully-owned копії з пакету) і згенеровані d.ts — не лінтимо.
      '.pi/extensions/**',
      'npm/.pi-template/**',
      'npm/types/**',
      // Канонічні Storybook-шаблони (storybook.mdc) — snippets, які fix-scaffold.mjs копіює
      // у консюмер-пакети (Vue-бібліотеки); foreign imports (vite/@vitejs/plugin-vue/quasar)
      // не є залежностями цього репо, і файли не виконуються тут.
      'plugins/lang-js/rules/storybook/scaffold/template/**',
      // Той самий принцип — canonical vitest-config-snippets (unit/storybook project-entry,
      // baseline-конфіги), які fix-vitest-config.mjs дописує/копіює у консюмер-пакети;
      // foreign imports (quasar/unplugin-auto-import/vite-plugin-pages тощо) не є
      // залежностями цього репо.
      'plugins/lang-js/rules/storybook/vitest-config/template/**'
    ]
  },
  ...getConfig({
    node: ['npm', 'llm-lib', 'plugins'],
    vue: ['demo']
  }),
  {
    files: ['npm/**/*.{mjs,cjs}', 'llm-lib/**/*.{mjs,cjs}', 'plugins/**/*.{mjs,cjs}'],
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
    files: ['npm/**/*.{js,mjs,cjs}', 'llm-lib/**/*.{js,mjs,cjs}', 'plugins/**/*.{js,mjs,cjs}'],
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
      'npm/tests/check-mjs-contract.test.mjs',
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
  // Hasura: кластерний endpoint мусить бути http:// (internal_urls.mdc визначає схему;
  // rule перенесено з колишнього hasura/js/ у hasura/internal_urls/ — glob звірено з
  // поточною структурою).
  {
    files: ['npm/rules/hasura/internal_urls/**/*.mjs'],
    rules: {
      '@microsoft/sdl/no-insecure-url': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'unicorn/prefer-https': 'off'
    }
  },
  // Semver-рядки в npm version range — короткі (< 100 символів), не ReDoS-загроза.
  {
    files: ['npm/rules/capacitor/js/platforms.mjs'],
    rules: {
      'sonarjs/slow-regex': 'off'
    }
  },
  // Динамічний RegExp із НЕ-user-input джерела (не ReDoS-вектор): glob із екранованими
  // спецсимволами (package_structure), reconstruct module-const `.source` з іншим прапором
  // (units-rs), regex із канонічного transform-спеку (stryker fix). Джерела — package.json/
  // канон/константи, не ввід користувача.
  {
    files: [
      'npm/rules/npm-module/package_structure/main.mjs',
      'plugins/lang-rust/doc-files/units-rs.mjs',
      'npm/rules/test/stryker_config/fix-stryker_config.mjs'
    ],
    rules: {
      'security/detect-non-literal-regexp': 'off'
    }
  },
  // Тести: prefer-specific-assertions — стилістика тест-асертів (toHaveLength/toBeNull замість
  // toBe(n)). Читабельність `expect(x).toBe(0)` у тестах прийнятна; не блокуємо CI на цьому.
  // (нове правило @nitra/eslint-config 3.10.3 — послаблено лише для тестових файлів.)
  {
    files: ['**/*.test.mjs', '**/tests/**/*.mjs'],
    rules: {
      'sonarjs/prefer-specific-assertions': 'off',
      // parameterized-tests: test.each-переписування — стилістика; явні окремі тести читаються
      // краще для канон-фікстур. explicit-test-skip: guard-return у тестах (skip за відсутності
      // локальної моделі/тулів) — усвідомлений патерн репо. publicly-writable-directories:
      // тести навмисно працюють у tmpdir(). Не блокуємо CI на цій стилістиці.
      'sonarjs/parameterized-tests': 'off',
      'sonarjs/explicit-test-skip': 'off',
      'sonarjs/publicly-writable-directories': 'off'
    }
  }
]
