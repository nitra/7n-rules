/**
 * Канонічний вигляд запису `storybook`-проєкту у `test.projects` для APP-пакетів
 * (хвиля 2a, storybook.mdc, vitest-config-концерн, живий пілот gt): той самий
 * browser-mode/chromium каркас, що й бібліотечний `storybook-project-entry.js`,
 * АЛЕ з ВЛАСНИМИ `quasar()`/`AutoImport()`/`Pages()`-плагінами замість голого
 * `extends: true` без додаткових плагінів.
 *
 * Причина асиметрії з бібліотекою: батьківський `baseVite` (unit-проєкт цього ж
 * vitest-конфіга, canon test.mdc — unit-ізоляція) свідомо СТРИПАЄ ці плагіни
 * (`vite:quasar`/`unplugin-auto-import`/`vite-plugin-pages` — `STRIPPED_PREFIXES`
 * канонічного `vitest.config.js`), а сторінкові stories app-проєкту (route.params +
 * Apollo-підписка + Pinia, хвиля 2a) реально їх потребують:
 * - `quasar({ sassVariables: true })` — інʼєкція SCSS-змінних (canon-шлях
 *   `src/css/quasar.variables.scss`, той самий, що шукає `storybook/hygiene`);
 * - `AutoImport({ imports: [...] })` — глобали (`ref`/`computed`, `useRoute`,
 *   Quasar-композаблі, Pinia-хелпери) без явного import у `.vue`-сторінках;
 * - `Pages()` — обробник custom-блоку `<route lang="yaml">` (без нього
 *   `@vitejs/plugin-vue` генерує імпорт віртуального route-блоку без обробника →
 *   помилка на будь-якій сторінці з `<route>`-блоком, не лише тій, що в story).
 *
 * Проєкт-специфічний auto-import (напр. GraphQL/Apollo-композаблі з власного
 * boot-файлу пакета) дописується вручну поверх цього мінімального канонічного
 * набору — той самий принцип, що й "gt-специфічні доповнення" в
 * `scaffold/template/app-preview.js`. Сам файл — валідний модуль лише для
 * JS-лінту репозиторію правил; `fix-vitest-config.mjs` зчитує лише вміст
 * `export default {...}`.
 */
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { quasar } from '@quasar/vite-plugin'
import AutoImport from 'unplugin-auto-import/vite'
import Pages from 'vite-plugin-pages'

/** Канонічний app-storybook-запис `test.projects` (зміст — у header-коментарі вище). */
export default {
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
