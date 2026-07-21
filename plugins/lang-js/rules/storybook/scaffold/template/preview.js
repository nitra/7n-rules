/**
 * Канонічний preview для Vue-компонентних бібліотек (storybook.mdc, ADR
 * канон-storybook-для-vue-компонентних-бібліотек). Згенеровано правилом `storybook` —
 * `npx @7n/rules fix storybook` відтворює цей файл, якщо його видалено чи зламано канон.
 */
import { setup } from '@storybook/vue3'
import { Dialog, iconSet as quasarBuiltinIconSet, Notify, Quasar } from 'quasar'
import iconSet from 'quasar/icon-set/svg-material-icons'
import { initialize, mswDecorator } from 'msw-storybook-addon'

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

/** @type {import('@storybook/vue3').Preview} */
const preview = {
  decorators: [mswDecorator],
  parameters: {
    controls: { matchers: { color: /(background|color)$/iu, date: /Date$/u } }
  }
}

export default preview
