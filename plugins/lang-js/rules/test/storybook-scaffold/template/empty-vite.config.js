/**
 * Канонічний ПОРОЖНІЙ Vite-конфіг — стенд-ін для `core.builder.options.viteConfigPath` у
 * `.storybook/main.js` (storybook.mdc, ADR канон-storybook-для-vue-компонентних-бібліотек).
 * `npx @7n/rules fix storybook` відтворює цей файл, якщо його видалено чи зламано канон.
 *
 * Навіщо: `@storybook/builder-vite` без явного `viteConfigPath` сам через
 * `loadConfigFromFile` знаходить `vite.config.js` ПАКЕТА і домерджує його НЕФІЛЬТРОВАНІ
 * плагіни (той самий `vue()`, обгорнутий VueMacros/unplugin-auto-import) ще ДО виклику
 * `viteFinal` у `main.js` — `mergeConfig` конкатенує масиви `plugins`, тож фільтр у
 * `viteFinal` лише ДОДАЄ ще один `@vitejs/plugin-vue`, а не прибирає вже змерджений
 * дублікат від builder-vite. Наслідок без цього файлу: `storybook build` (саме `build`,
 * не `dev`!) падає на кожному `.vue` з "At least one <template> or <script> is required" —
 * подвійна SFC-трансформація. `dev --smoke-test` цю різницю НЕ ловить (лінива
 * трансформація), лише повний `build`. Перевірено емпірично на пілотному консюмері.
 */
import { defineConfig } from 'vite'

export default defineConfig({})
