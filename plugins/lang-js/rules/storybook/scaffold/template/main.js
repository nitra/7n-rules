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
// рендері одного компонента, знімаються при обʼєднанні з vite.config пакета. Обидві
// версії layouts-пакета (старий і `-next`-форк) та pages-роутери — реальні консюмери
// мігрують поступово, старий і новий пакет можуть співіснувати в різних vite.config.
const INCOMPATIBLE_PLUGIN_NAMES = new Set([
  'vite-plugin-pages',
  'unplugin-vue-router',
  'vite-plugin-vue-layouts',
  'vite-plugin-vue-layouts-next'
])

/**
 * Плагін належить до сімейства Vue SFC-трансформерів, які ДУБЛЮЮТЬ `OWN_PLUGINS`'
 * `vue()`. Реальний стек консюмерів (components/npm/vite.config.js) обгортає
 * `@vitejs/plugin-vue` через `VueMacros({ plugins: { vue: Vue() } })` — після
 * резолву цей виклик повертає МАСИВ плагінів: сам `vite:vue` (той самий transform,
 * що й `OWN_PLUGINS`' `vue()` — дублювання дає ПОДВІЙНУ SFC-трансформацію) плюс
 * службові `vue-macros-*` (devtools/exclude-dep-optimize). Плагіни macro-синтаксису
 * (`unplugin-vue-define-props`/`define-emit`/`reactivity-transform` тощо) — НЕ
 * фільтруються: вони не дублюються `OWN_PLUGINS` і потрібні для macro-фіч пакета;
 * Vite впорядковує їх через власний `enforce: 'pre'|'post'` незалежно від позиції
 * в підсумковому масиві `plugins`, тож порядок відносно `OWN_PLUGINS` тут не важливий.
 * @param {string | undefined} name ім'я плагіна
 * @returns {boolean} true — плагін дублює `OWN_PLUGINS`' `vue()`
 */
function isVueTransformFamily(name) {
  return typeof name === 'string' && (name.startsWith('vite:vue') || name.includes('vue-macros'))
}

/**
 * Резолвить один запис `config.plugins` у плаский масив реальних плагінів. Vite
 * офіційно підтримує `Plugin | Promise<Plugin> | (Plugin | Promise<Plugin>)[]`
 * (довільна вкладеність) — `VueMacros(...)` сам повертає `Promise`, що резолвиться
 * в масив плагінів. `loadConfigFromFile` читає файл конфіга як є й НЕ виконує це
 * resolve/flatten (це робить лише повний `resolveConfig` пізніше у власному циклі
 * Vite) — без ручного resolve/flatten тут фільтр порівнював би ім'я з
 * `Promise`-об'єктом, що ще не резолвився (`undefined`), і пропускав би дублікат далі.
 * @param {unknown} entry один елемент/Promise/масив із `config.plugins`
 * @returns {Promise<object[]>} плаский масив плагінів після resolve
 */
async function resolvePluginEntry(entry) {
  const resolved = await entry
  if (Array.isArray(resolved)) {
    const nested = await Promise.all(resolved.map(resolvePluginEntry))
    return nested.flat(Infinity)
  }
  return resolved ? [resolved] : []
}

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
    const rawPlugins = loaded?.config?.plugins ?? []
    const resolvedNested = await Promise.all(rawPlugins.map(resolvePluginEntry))
    const userPlugins = resolvedNested
      .flat(Infinity)
      .filter(Boolean)
      .filter(p => !INCOMPATIBLE_PLUGIN_NAMES.has(p.name))
      // vue()/quasar() пакета замінюємо власними екземплярами у фіксованому порядку вище —
      // не дублюємо; решта плагінів пакета (auto-import, VueMacros macro-sugar тощо) лишається.
      .filter(p => !isVueTransformFamily(p.name) && p.name !== 'quasar')

    return mergeConfig(storybookConfig, {
      resolve: loaded?.config?.resolve,
      css: loaded?.config?.css,
      plugins: [...OWN_PLUGINS, ...userPlugins]
    })
  }
}

export default config
