/**
 * Канонічний конфіг Storybook для Vue-компонентних бібліотек (storybook.mdc, ADR
 * канон-storybook-для-vue-компонентних-бібліотек). Згенеровано правилом `storybook` —
 * `npx @7n/rules fix storybook` відтворює цей файл, якщо його видалено чи зламано канон.
 */
import { loadConfigFromFile, mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'

// Плагіни власного Vite-збирача Storybook — порядок ФІКСОВАНИЙ: @vitejs/plugin-vue
// ПЕРЕД quasar() (інакше Quasar-плагін не бачить SFC, уже скомпільований plugin-vue).
const OWN_PLUGINS = [vue({ template: { transformAssetUrls } }), quasar({ sassVariables: true })]

// Плагіни файлової маршрутизації додатка-споживача — не мають сенсу в ізольованому
// рендері одного компонента, знімаються при обʼєднанні з vite.config пакета.
const INCOMPATIBLE_PLUGIN_NAMES = new Set(['vite-plugin-pages', 'vite-plugin-vue-layouts'])

/** @type {import('@storybook/vue3-vite').StorybookConfig} */
const config = {
  stories: ['__STORYBOOK_STORIES_GLOB__'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {}
  },
  // Публічний asset для msw service worker, який ініціалізує preview.js.
  staticDirs: ['./public'],
  async viteFinal(storybookConfig) {
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, process.cwd())
    const userPlugins = (loaded?.config?.plugins ?? [])
      .flat()
      .filter(Boolean)
      .filter(p => !INCOMPATIBLE_PLUGIN_NAMES.has(p.name))
      // vue()/quasar() пакета замінюємо власними екземплярами у фіксованому порядку вище —
      // не дублюємо; решта плагінів пакета (auto-import, svg-loader тощо) лишається.
      .filter(p => p.name !== 'vite:vue' && p.name !== 'quasar')

    return mergeConfig(storybookConfig, {
      resolve: loaded?.config?.resolve,
      css: loaded?.config?.css,
      plugins: [...OWN_PLUGINS, ...userPlugins]
    })
  }
}

export default config
