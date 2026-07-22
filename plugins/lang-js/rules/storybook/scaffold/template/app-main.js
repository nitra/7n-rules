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
 * `viteFinal` лише ЗНІМАЄ file-system-routing плагіни консюмера (`vite-plugin-pages`,
 * `vite-plugin-vue-layouts`/`-next`, `unplugin-vue-router`) — story імпортує сторінку
 * напряму, маршрут будує `pageLoader` з `.storybook/preview.js`.
 */
const ROUTING_PLUGIN_PREFIXES = [
  'vite-plugin-pages',
  'unplugin-vue-router',
  'vite-plugin-vue-layouts',
  'vite-plugin-vue-layouts-next'
]

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

export default config
