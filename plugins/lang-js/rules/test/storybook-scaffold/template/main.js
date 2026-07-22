/**
 * Канонічний конфіг Storybook для Vue-компонентних бібліотек (storybook.mdc, ADR
 * канон-storybook-для-vue-компонентних-бібліотек). Згенеровано правилом `storybook` —
 * `npx @7n/rules fix storybook` відтворює цей файл, якщо його видалено чи зламано канон.
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadConfigFromFile, mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'

// Абсолютний каталог `.storybook/` (де лежить сам main.js) — потрібен нижче для
// `core.builder.options.viteConfigPath` (порожній стенд-ін лежить поруч).
const dirName = dirname(fileURLToPath(import.meta.url))

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
  core: {
    builder: {
      name: '@storybook/builder-vite',
      // ОБОВ'ЯЗКОВИЙ обхід (емпірично підтверджено — лише через `storybook build`, dev
      // smoke-test не ловить): без цього `@storybook/builder-vite` сам через
      // `loadConfigFromFile` знаходить `../vite.config.js` пакета ще ДО виклику
      // `viteFinal` нижче й домерджує його НЕФІЛЬТРОВАНІ плагіни (VueMacros-обгорнутий
      // `vue()`, layout-роутинг тощо) у storybookConfig. `mergeConfig` конкатенує масиви
      // `plugins`, тож фільтр у `viteFinal` лише ДОДАЄ ще один `@vitejs/plugin-vue`, а НЕ
      // прибирає вже змерджений builder-vite дублікат — подвійна SFC-трансформація,
      // `storybook build` падає на кожному `.vue` з "At least one <template> or <script>
      // is required". `viteConfigPath` на порожній стенд-ін (`empty-vite.config.js`,
      // канонічний сусідній файл цього скафолда) блокує це autodiscovery повністю.
      options: { viteConfigPath: join(dirName, 'empty-vite.config.js') }
    }
  },
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
