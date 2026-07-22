import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './__VITE_CONFIG_IMPORT__'

// Ізольований vitest-конфіг лише для Stryker (test.mdc, storybook.mdc, ADR
// Кластер 5): @stryker-mutator/vitest-runner крашиться на browser-mode
// `projects` основного vitest.config (canonical `unit`+`storybook`) — тому
// Stryker отримує окремий конфіг з тим самим unit-набором і без
// storybook-project/browser-mode. `stryker.config.mjs#vitest.configFile`
// пакета має вказувати саме сюди.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
      environment: 'happy-dom',
      coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
    }
  })
)
