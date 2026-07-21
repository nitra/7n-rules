import { defineConfig, mergeConfig } from 'vitest/config'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import viteConfig from './__VITE_CONFIG_IMPORT__'

// Канонічний vitest-конфіг Vue-компонентної бібліотеки у скоупі Storybook
// (storybook.mdc, vitest-config-концерн, ADR Кластер 5): named projects
// `unit` + `storybook`. Ізольований `vitest.stryker.config` (поруч, той
// самий concern генерує) — той самий unit-набір БЕЗ browser-mode
// `projects`, бо @stryker-mutator/vitest-runner крашиться на них.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
      environment: 'happy-dom',
      coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] },
      projects: [
        { extends: true, test: { name: 'unit' } },
        {
          extends: true,
          plugins: [storybookTest({ configDir: '.storybook' })],
          test: {
            name: 'storybook',
            include: ['__STORYBOOK_STORIES_GLOB__'],
            browser: {
              enabled: true,
              headless: true,
              provider: 'playwright',
              instances: [{ browser: 'chromium' }]
            },
            setupFiles: ['.storybook/vitest.setup.js']
          }
        }
      ]
    }
  })
)
