import { defineConfig, mergeConfig } from 'vitest/config'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { quasar } from '@quasar/vite-plugin'
import AutoImport from 'unplugin-auto-import/vite'
import Pages from 'vite-plugin-pages'
import viteConfig from './__VITE_CONFIG_IMPORT__'

// Канонічний vitest-конфіг APP-проєкту (хвиля 2a) у скоупі Storybook (storybook.mdc,
// vitest-config-концерн, ADR Кластер 5): named projects `unit` + `storybook`, той
// самий каркас, що й бібліотечний `vitest.config.baseline.mjs`, АЛЕ storybook-проєкт
// отримує ВЛАСНІ quasar()/AutoImport()/Pages()-плагіни — деталі й обґрунтування
// коментарем у `app-storybook-project-entry.js` (той самий блок plugins тут — генерація
// повністю нового файлу для пакета без жодного наявного vitest-конфіга не переюзає
// entry-шаблон як текст, лише дублює його канонічну форму).
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
          plugins: [
            storybookTest({ configDir: '.storybook' }),
            quasar({ sassVariables: true }),
            AutoImport({ imports: ['vue', 'vue-router', 'quasar', 'pinia'] }),
            Pages()
          ],
          test: {
            name: 'storybook',
            include: ['__STORYBOOK_STORIES_GLOB__'],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: 'chromium' }]
            },
            setupFiles: ['.storybook/vitest.setup.js']
          }
        }
      ]
    }
  })
)
