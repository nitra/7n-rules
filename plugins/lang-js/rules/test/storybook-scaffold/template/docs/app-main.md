---
type: JS Module
title: app-main.js
resource: plugins/lang-js/rules/test/storybook-scaffold/template/app-main.js
docgen:
  crc: 4bfd40b5
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`.storybook/main.js` є канонічною Storybook-конфігурацією для app-проєктів; `npx @7n/rules fix storybook` відновлює її, якщо файл видалено або зламано. На відміну від бібліотечного `scaffold/template/main.js`, тут свідомо немає `core.builder.options.viteConfigPath`: Storybook має підхоплювати повний `vite.config.js` застосунку, щоб stories бачили ті самі build-time можливості, assets і Quasar-налаштування, що й основний app.

Конфігурація прибирає лише генератори маршрутизації та layout-обгорток, зайві для прямих story-імпортів сторінок: `unplugin-vue-router`, `vite-plugin-vue-layouts` і `vite-plugin-vue-layouts-next`. Маршрут для story будує `pageLoader` із `.storybook/preview.js`, тому app-рівнева файлова маршрутизація тут не потрібна.

`vite-plugin-pages` НЕ знімається, бо він потрібен для коректної обробки сторінкових блоків `<route lang="yaml">`. Без нього Vue-прохід лишає імпорти на кшталт `?vue&type=route` без обробника, що призводить до Rolldown `[MISSING_EXPORT] "default" is not exported by …` і валить `storybook build` для пакета.

## Поведінка

1. Оголошує канонічну Storybook-конфігурацію для app-проєктів, яку правило `storybook` може відновити під час автоматичного виправлення.

2. Підключає stories за згенерованим шаблоном і запускає їх через Vue 3 Vite-інтеграцію Storybook.

3. Додає публічні assets із `public`, щоб Storybook мав доступ до service worker для mock-інфраструктури.

4. Свідомо використовує повний Vite-конфіг app-проєкту, щоб сторінки працювали з тими самими build-time макросами, auto-import та Quasar-налаштуваннями, що й основний застосунок.

5. Не застосовує бібліотечний обхід із окремим Vite-конфігом, бо для app-сторінок це прибрало б потрібні build-time можливості й могло б зламати реальну поведінку сторінок.

6. Перед складанням Storybook прибирає лише генератори файлової маршрутизації та layout-обгорток консюмера, бо stories імпортують сторінки напряму, а тестовий маршрут формується окремо у preview-шарі.

7. Залишає обробник сторінкових route-блоків активним, щоб Storybook docgen міг проходити сторінки з per-page metadata без падіння всього build.

8. Повертає змінений Vite-конфіг Storybook-збирачу без власних операцій запису.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
