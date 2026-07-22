---
type: JS Module
title: app-preview.js
resource: plugins/lang-js/rules/test/storybook-scaffold/template/app-preview.js
docgen:
  crc: 503c6e11
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:pageLoader,judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний `.storybook/preview.js` для app-проєктів: саме він визначає, як `storybook` готує page stories у стандартному середовищі рендеру.  
`pageLoader` створює для кожної story окремі `router` і `pinia` з `parameters.route` та `parameters.pinia`, а `await router.isReady` у `loaders` прибирає перший рендер без `route.params`.  
Стан story сідиться через `structuredClone`, щоб дані не перетікали між stories.  
GraphQL `query`, `mutation` і `subscription` мокається мережево через `msw-storybook-addon` з worker `.storybook/public/mockServiceWorker.js`.

## Поведінка

1. Для storybook-проєкту готує канонічне середовище рендеру сторінок і відтворює його як стандартний шаблон, щоб однаково запускати сторінкові stories у всіх app-проєктах.
2. Під час запуску підключає мережеве мокування для GraphQL-запитів через `msw-storybook-addon`, щоб ізолювати stories від реального backend і не підміняти app-код через `resolve.alias`.
3. Для кожної story окремо збирає маршрутний контекст до першого рендера, щоб сторінка одразу бачила готові route-дані без проміжного порожнього стану.
4. Для stories, які залежать від стану, створює окремий стан на кожен прогін і засіває його з початкових даних story, щоб сценарії стартували з контрольованого стану без впливу попередніх story.
5. Піднімає Quasar-оточення так, щоб сторінкові компоненти могли коректно працювати в Storybook, включно з layout-контейнером для сторінок.
6. Встановлює повноекранний режим рендеру, щоб сторінкові stories поводилися як справжні екрани застосунку, а не як фрагменти UI.
7. Якщо story не надає маршрут або стан, не вигадує їх самостійно, а залишає ці частини порожніми для явного налаштування в самій story.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
