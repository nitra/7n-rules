/**
 * Канонічний `.storybook/main.js` для app-проєктів (хвиля 2a, storybook.mdc, ADR
 * канон-storybook-для-vue-компонентних-бібліотек, розділ «Розширення (2026-07-20):
 * сторінки»). Згенеровано правилом `storybook` — `npx @7n/rules fix storybook`
 * відтворює цей файл, якщо його видалено чи зламано канон.
 *
 * Свідома дзеркальна асиметрія з бібліотечним `.storybook/main.js` (`scaffold/template/main.js`):
 * тут НЕМАЄ `core.builder.options.viteConfigPath`-обходу. `@storybook/builder-vite`
 * сам підхоплює ПОВНИЙ `vite.config.js` app-проєкту (VueMacros/`$ref`,
 * `unplugin-auto-import`, `quasar()` лишаються як є, без власних інстансів у
 * `viteFinal`) — сторінки використовують build-time макроси (`$ref`), тож власний
 * Vue/Quasar-інстанс тут, на відміну від бібліотек, зайвий і навіть шкідливий.
 *
 * `viteFinal` знімає ЛИШЕ справжні layout/router-генератори консюмера
 * (`unplugin-vue-router`, `vite-plugin-vue-layouts`/`-next`) — вони СПОЖИВАЮТЬ уже
 * розпарсений `<route>`-meta для генерації layout-обгортки навколо файлової
 * маршрутизації, яка тут не потрібна (story імпортує сторінку напряму, маршрут
 * будує `pageLoader` з `.storybook/preview.js`). `vite-plugin-pages` НЕ знімається
 * (перевірено практично на `gt`, канон-фікс хвилі 2a): прототипні сторінки з
 * custom-блоком `<route lang="yaml">` (типова конвенція `vite-plugin-pages` для
 * per-page layout/meta — `Login.vue`, `Closed.vue`, `Code.vue`, `[...all].vue`)
 * без самого `vite-plugin-pages`-плагіна лишаються без обробника цього custom-блоку
 * → `@vitejs/plugin-vue` генерує `import block0 from '<файл>?vue&type=route&…&lang.yaml'`,
 * який ніхто не обробляє далі → Rolldown `[MISSING_EXPORT] "default" is not exported by …`
 * → `storybook build` падає для ВСЬОГО пакета (не лише для сторінки в story), навіть
 * якщо жодної story немає. `vite-plugin-pages` сам по собі — no-op для наших stories
 * (генерує `virtual:generated-pages`, який ніхто не імпортує з `.storybook/preview.js`
 * чи story-файлів), просто лишається активним і мовчки обробляє `<route>`-блоки для
 * docgen-проходу Storybook по решті `src/pages/`.
 */
const ROUTING_PLUGIN_PREFIXES = ['unplugin-vue-router', 'vite-plugin-vue-layouts', 'vite-plugin-vue-layouts-next']

/** @type {import('@storybook/vue3-vite').StorybookConfig} */
const config = {
  stories: ['__STORYBOOK_STORIES_GLOB__'],
  framework: '@storybook/vue3-vite',
  // Публічний asset для msw service worker (див. .storybook/preview.js).
  staticDirs: ['./public'],
  viteFinal(viteConfig) {
    viteConfig.plugins = (viteConfig.plugins ?? [])
      .flat(Number.POSITIVE_INFINITY)
      .filter(p => p && !ROUTING_PLUGIN_PREFIXES.some(prefix => p.name?.startsWith(prefix)))
    return viteConfig
  }
}

/** Storybook-конфіг app-проєкту — його читає Storybook-збирач консюмер-пакета. */
export default config
