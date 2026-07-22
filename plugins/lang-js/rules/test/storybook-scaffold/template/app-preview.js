/**
 * Канонічний `.storybook/preview.js` для app-проєктів (хвиля 2a, storybook.mdc, ADR
 * канон-storybook-для-vue-компонентних-бібліотек, розділ «Розширення (2026-07-20):
 * сторінки»). Прототип-verified на `gt` (`src/pages/task/[id].vue`). Згенеровано
 * правилом `storybook` — `npx @7n/rules fix storybook` відтворює цей файл, якщо
 * його видалено чи зламано канон.
 *
 * Рішення ADR-розширення: GraphQL (query/mutation/**підписка**) мокається виключно
 * мережево через `msw-storybook-addon` (worker `.storybook/public/mockServiceWorker.js`,
 * `bunx msw init .storybook/public --no-save`) — жодних `resolve.alias`-підмін
 * app-коду (Apollo-boot лишається повністю справжнім, story-файл сам підключає
 * свій `apolloPlugin`, канонізувати цей імпорт неможливо — шлях app-специфічний).
 *
 * `pageLoader` — канонічний хелпер, який будує `router`/`pinia` на кожну story ДО
 * mount за `parameters.route`/`parameters.pinia` story-файлу (не `args`, не
 * декоратор): `await router.isReady()` у `loaders` прибирає перший рендер без
 * `route.params`, `createPinia()` — БЕЗ `pinia-plugin-persistedstate` (`persist: true`
 * у сторах стає no-op), сідінг стану — `structuredClone(parameters.pinia.initialState)`.
 */
import { setup } from '@storybook/vue3-vite'
import { initialize, mswLoader } from 'msw-storybook-addon'
import { createPinia } from 'pinia'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createMemoryHistory, createRouter } from 'vue-router'
import 'quasar/dist/quasar.css'

initialize({
  // GET-и того ж origin — vite dev-модулі/ассети, не API: пропускаємо мовчки.
  // Усе інше — warn, лише справжні незамокані API-виклики (POST на gateway тощо).
  onUnhandledRequest(request, print) {
    if (request.method === 'GET' && new URL(request.url).origin === globalThis.location.origin) {
      return
    }
    print.warning()
  }
})

/**
 * Loader сторінкових stories: до mount будує memory-router за `parameters.route`
 * і Pinia за `parameters.pinia` — щоб route.params були готові вже на перший рендер
 * (`await isReady()`), а стори стартували з посіяного стану.
 * @param {import('@storybook/vue3-vite').StoryContext} ctx контекст story
 * @returns {Promise<object>} loaded-обʼєкти для `setup` (router, pinia)
 */
async function pageLoader(ctx) {
  const loaded = {}

  if (ctx.parameters.route) {
    const { path, url } = ctx.parameters.route
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        // Компонент маршруту порожній: story рендерить сторінку сама, роутер
        // потрібен лише як джерело route.params для useRoute().
        { path, component: { render: () => null } },
        { path: '/:catchAll(.*)*', component: { render: () => null } }
      ]
    })
    router.replace(url)
    await router.isReady()
    loaded.router = router
  }

  if (ctx.parameters.pinia) {
    // Справжня Pinia БЕЗ pinia-plugin-persistedstate — persist: true у сторах
    // стає no-op, localStorage не читається й не пишеться.
    const pinia = createPinia()
    Object.assign(pinia.state.value, structuredClone(ctx.parameters.pinia.initialState ?? {}))
    loaded.pinia = pinia
  }

  return loaded
}

setup((app, ctx) => {
  app.use(Quasar)
  // QLayout/QPageContainer реєструються явно: Quasar SFC-transform не працює
  // в runtime-темплейтах decorator-ів, а q-page кидає виняток без layout-предка.
  app.component('QLayout', QLayout)
  app.component('QPageContainer', QPageContainer)
  if (ctx?.loaded?.router) {
    app.use(ctx.loaded.router)
  }
  if (ctx?.loaded?.pinia) {
    app.use(ctx.loaded.pinia)
  }
})

/** @type {import('@storybook/vue3-vite').Preview} */
const preview = {
  loaders: [mswLoader, pageLoader],
  parameters: { layout: 'fullscreen' }
}

/** Storybook preview app-проєкту: msw-loader і pageLoader для сторінкових stories консюмера. */
export default preview
