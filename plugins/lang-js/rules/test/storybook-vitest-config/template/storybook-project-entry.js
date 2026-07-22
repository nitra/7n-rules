/**
 * Канонічний вигляд запису `storybook`-проєкту у `test.projects` (storybook.mdc,
 * vitest-config-концерн, ADR Кластер 5): browser-mode, лише chromium, stories-glob
 * (`__STORYBOOK_STORIES_GLOB__` — токен, `detectStoriesGlob` зі scaffold-концерна
 * без префіксу `../`). `provider: playwright()` — factory-виклик з
 * `@vitest/browser-playwright`, не рядок `'playwright'`: vitest@^4 прибрав рядкове
 * API провайдера, `@vitest/browser-playwright` — окремий пакет (не входить у
 * `@vitest/browser`). Сам файл — валідний модуль лише для JS-лінту репозиторію
 * правил; `fix-vitest-config.mjs` зчитує лише вміст `export default {...}`.
 */
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'

/** Канонічний storybook-запис `test.projects` (зміст — у header-коментарі вище). */
export default {
  extends: true,
  plugins: [storybookTest({ configDir: '.storybook' })],
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
