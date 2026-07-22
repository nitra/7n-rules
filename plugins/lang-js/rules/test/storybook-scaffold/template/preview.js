/**
 * Канонічний preview для Vue-компонентних бібліотек (storybook.mdc, ADR
 * канон-storybook-для-vue-компонентних-бібліотек). Згенеровано правилом `storybook` —
 * `npx @7n/rules fix storybook` відтворює цей файл, якщо його видалено чи зламано канон.
 */
import { setup } from '@storybook/vue3-vite'
import { Dialog, Notify, Quasar } from 'quasar'
import iconSet from 'quasar/icon-set/svg-material-icons'
// Імпорт через підшлях пакета — НЕ named-import `iconSet` напряму з `quasar`: quasar
// 2.18.x не має цього імені як runtime-binding (лише компонент `IconSet` з великої
// літери), і `@quasar/vite-plugin`-transform падає з "Unknown import from Quasar" на
// такому специфікаторі. Підшлях (як і кастомний `iconSet` вище) обходить transform повністю.
import quasarBuiltinIconSet from 'quasar/icon-set/material-icons'
import { initialize, mswLoader } from 'msw-storybook-addon'

import 'quasar/dist/quasar.css'

// msw-storybook-addon: перехоплює мережеві запити компонентів у Storybook. Same-origin GET
// (Vite HMR, статичні файли dev-сервера) — очікуваний шум, мовчки пропускаємо; усе інше —
// warn (не білд-помилка навмисно, хвиля 1 — м'який сигнал, не гейт).
initialize({
  onUnhandledRequest(request, print) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.origin === globalThis.location?.origin) return
    print.warning()
  }
})

setup(app => {
  // Повний install Quasar (не окремі компоненти) — бібліотека компонентів очікує
  // глобально зареєстровані Quasar-примітиви (QBtn, QCard тощо) так само, як у реальному
  // додатку-споживачі.
  app.use(Quasar, {
    plugins: { Notify, Dialog },
    iconSet,
    // iconMapFn — без нього внутрішні Quasar-компоненти (напр. стрілка QSelect) не
    // резолвлять власні вбудовані іконки поза full Quasar CLI build.
    iconMapFn(iconName) {
      return quasarBuiltinIconSet.iconMapFn?.(iconName)
    }
  })
})

/** @type {import('@storybook/vue3-vite').Preview} */
const preview = {
  // mswLoader (не mswDecorator — deprecated у msw-storybook-addon 2.x, буде видалений
  // у наступному релізі): loaders виконуються per-story ДО рендеру й інтегруються з
  // async story-рендерингом Storybook, на відміну від декоратора.
  loaders: [mswLoader],
  parameters: {
    controls: { matchers: { color: /(background|color)$/iu, date: /Date$/u } }
  }
}

/** Storybook preview Vue-бібліотеки: Quasar-setup і msw-loader для stories консюмера. */
export default preview
