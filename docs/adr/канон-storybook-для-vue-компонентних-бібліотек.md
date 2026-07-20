---
type: ADR
title: "Канон Storybook для Vue-компонентних бібліотек"
---

# Канон Storybook для Vue-компонентних бібліотек

**Status:** Accepted
**Date:** 2026-07-20

## Context and Problem Statement

Storybook вручну впроваджено двічі в різних nitra-репо (`tauri-components`, `nitra/components`) в одній і тій самій сесії — обидва рази з однаковим набором нетривіальних, невидимих заздалегідь проблем: конфлікт `@vitejs/plugin-vue` з наявним `vite.config.js` пакета (`n-vue.mdc`-конвенція), краш `@stryker-mutator/vitest-runner` на vitest-конфізі з browser-mode `projects`, недоступність внутрішніх Quasar-іконок без явного `iconSet`+`iconMapFn`, необхідність ручного мокання router/Apollo/i18n. Паралельне ручне впровадження в тому самому вікні часу призвело до реального merge-конфлікту між двома незалежними реалізаціями тієї самої фічі. Потрібне канонічне правило (за зразком `n-vue.mdc`, `n-test.mdc`), яке робить Storybook стандартом для всіх Vue-компонентних бібліотек монорепо-екосистеми, а не одноразовим ручним рішенням кожного агента.

Скоуп: лише Vue-пакети з `vue` у `peerDependencies` (маркер `isVueComponentLibraryPkg`, уже використовується `n-vue.mdc`) — усі відомі такі пакети вже на Quasar, тож Quasar-специфіку (Notify/Dialog/iconMapFn/SCSS-змінні) можна зашити прямо в канон, без framework-agnostic абстракції.

## Considered Options

- **Обов'язковий гейт одразу з повною глибиною автоматизації** (мандатний `alwaysApply: true` + LLM-генерація args для stories з першого дня, за зразком doc-files) — початковий вибір користувача.
- **Хвильовий rollout**: перша хвиля — обов'язковий скафолдинг + coverage-інтеграція + governance-винятки, без LLM-генерації args; LLM-генерація stories (найризикованіша, найменш обкатана частина) — друга хвиля того самого канону. Рекомендація фасилітатора.
- Чисто advisory-скіл без гейту (без блокування) — відкинуто на етапі контексту, користувач одразу обрав обов'язковий гейт.
- Мандатний гейт лише для нових пакетів, існуючі мігрують добровільно — відкинуто, користувач обрав обов'язковий гейт і для існуючих пакетів.

## Decision Outcome

Chosen option: **"Хвильовий rollout"** — перша хвиля канону покриває: (1) детекцію скоупу за `isVueComponentLibraryPkg` + поріг ≥3 `.vue`-файлів, (2) канонічний скафолд `.storybook/main.js`/`preview.js` (Quasar full install, `iconSet`+`iconMapFn`-комбо, вбудований `viteConfigPath`-override), (3) canonical `vitest.config` `projects: [unit, storybook]` + ізольований `vitest.stryker.config` (фікс Stryker-краху), (4) мінімальні рецепти мокання (router/Apollo-alias/tfm-noop) без LLM-контрактного мокання, (5) перевірку гігієни third-party-залежностей, (6) governance-винятки в `n-npm-module.mdc`/`n-bun.mdc`, (7) rollout через `alwaysApply: false` + `--adopt`-режим і пілот на одному репо перед глобальним увімкненням. LLM-генерація args для stories (найризикованіша частина, на відміну від doc-files де pipeline вже production-proven) — явно відкладена на другу хвилю того самого канону, не на невизначене майбутнє.

Facilitator recommended the wave-based split, because rolling out `alwaysApply: true` simultaneously with untested LLM-generated stories risks an org-wide simultaneous CI block across every Vue package if the generation pipeline has a systemic bug (unlike doc-files, which is already production-proven); user initially chose "all at once" but changed the decision after this concrete blast-radius argument and accepted the wave split.

### Consequences

- Good, because перша хвиля повністю спирається на вже двічі перевірені вживу рішення (скафолд, Stryker-ізоляція, coverage-контракт) — низький технічний ризик, високий effort/impact.
- Good, because `--adopt`-режим і пілотування прямо усувають клас проблеми, що щойно стався (merge-конфлікт двох паралельних ручних впроваджень).
- Bad, because LLM-генерація stories (заявлений пріоритет користувача) відкладається на другу хвилю — Storybook після хвилі 1 матиме лише мінімальні/ручні stories, не повний автогенерований набір, доки хвиля 2 не готова.
- Bad, because мінімальний рецепт мокання (без LLM-контрактного аналізу) покриває лише 2-3 відомі типи зовнішніх залежностей (router/Apollo/i18n) — нові типи залежностей у майбутніх пакетах вимагатимуть ручного розширення рецептів.

## More Information

Повний список ідей сесії (нумерація за кластерами, для трасування рішення):

**Кластер 1 — Тригер/скоуп:** маркер `isVueComponentLibraryPkg`; ширший тригер за кількістю `.vue`-файлів; поріг ≥3 компонентів; opt-out прапорець у `.n-rules.json`; skip нестандартного build.

**Кластер 2 — Скафолд:** канонічні `main.js`/`preview.js` (порядок плагінів фіксований — `@vitejs/plugin-vue` перед `quasar()`); layout-детекція (флет vs `src/components/`); вбудований `viteConfigPath`-override; уніфікований `package.json#scripts.storybook`; `.env`-генерація зі сканування `import.meta.env.VITE_*`.

**Кластер 3 — Мокання:** router (`createMemoryHistory` + catch-all, за детекцією `useRoute`/`useRouter`); `@nitra/tfm` — no-op, задокументувати явно; Apollo/GraphQL — `resolve.alias` на `.storybook/mocks/<slug>.js`, рецепт документований, генерація вручну за потреби; LLM-контрактне мокання довільних модулів — поза MVP; мережеві side-effect компоненти — маркер "лише display-стан" у stories.

**Кластер 4 — LLM-генерація stories (хвиля 2):** локальний omlx pipeline (як doc-files); вхід — `defineProps`/`defineEmits`/slots + crossreference реального використання в консюмер-пакетах монорепо; CRC-staleness у frontmatter stories-файлу; degraded-маркер + `parameters.badges`; escape hatch `// n-storybook:manual`; guardrail — не вигадувати props поза `defineProps`; multi-variant generation за `v-if`-гілками/enum-статусами.

**Кластер 5 — Coverage/Stryker/Playwright:** named vitest project `"storybook"` дописується поверх наявного `test`-блоку; ізольований `vitest.stryker.config` генерується автоматично разом із `projects`-масивом; Playwright-кеш у composite action; nightly-only `@7n/test coverage` (mutation testing), PR — лише швидкий `--project=storybook`; лише chromium.

**Кластер 6 — Гігієна залежностей:** перевірка undeclared third-party imports у `.vue`-файлах (реальний кейс — зламаний default-export `@vuepic/vue-datepicker` v14); auto-detect global SCSS vars → `sassVariables: true`; breaking-change guard при мажорному апгрейді третьосторонніх пакетів.

**Кластер 7 — Governance:** офіційний виняток у `n-npm-module.mdc` (Storybook-devDeps у `npm/package.json`, не в корені — обґрунтування: `@7n/test`'s `isStorybookRoot()` читає саме цей файл); симетричний виняток `n-bun.mdc`; canonical version pin на рівні кореня монорепо; review-гейт лише для новостворених stories.

**Кластер 8 — Rollout/adoption:** `alwaysApply: false` спершу; `--adopt`-режим для пакетів з уже наявним ручним Storybook (діагностує diff, не перезаписує сліпо); circuit breaker — деградація до warning для окремого зламаного пакета; порядок rollout за розміром (малі пакети спершу).

**Кластер 9 — Відкладено (поза MVP, без зобов'язань):** телеметрія перегляду Storybook; readiness-стадійність `draft`/`reviewed`/`stable`; крос-пакетна композиція ("Storybook of Storybooks"); PR-preview деплой; visual regression / Chromatic-подібний snapshot-diffing.

Відкриті питання (не закриті в сесії, залишаються для реалізаційної фази):
- ~~Чи розширювати скоуп на app-проєкти (`demo/`-подібні), чи лишити тільки component-library пакети.~~ — закрито розширенням від 2026-07-20 (див. нижче): app-проєкти входять у скоуп другою хвилею.
- Порт `storybook dev` при кількох Vue-пакетах в одному монорепо (фіксований vs авто-інкремент).
- Чи є в nitra-екосистемі інші типові зовнішні залежності (крім router/Apollo/tfm), які варто покрити canonical-рецептами заздалегідь. — частково закрито розширенням від 2026-07-20: Pinia (з `pinia-plugin-persistedstate`) і Apollo-**підписки** (graphql-sse) отримали canonical-рецепти.
- Хто саме рев'юїть LLM-згенеровані stories перед мержем (хвиля 2) — окремий чекліст у PR-темплейті чи звичайний code review.

## Розширення (2026-07-20): сторінки — route.params + Apollo subscription + Pinia

Розширення Кластера 3 (мокання) за результатами окремої brainstorm-сесії на реальному кейсі `gt`; не нова тема і не supersede — базове рішення вище лишається чинним.

### Context and Problem Statement

Перша редакція канону свідомо покриває лише презентаційні компоненти (props/emit). Сторінки app-проєктів (`src/pages/*.vue`) — реальний кейс `gt` (`task/[id].vue`, `Tasks.vue`) — живуть з інших джерел даних: `route.params` + **жива Apollo-підписка** (`useSubscription`, транспорт — graphql-sse поверх fetch, не WebSocket) + **Pinia-стори** (`persistStore` з `persist: true` через `pinia-plugin-persistedstate`, `activeTaskStore`). `unplugin-auto-import` робить `gql`/`useSubscription`/`apolloQuery`/`apolloMutate` глобалами з `src/njs/boot/apollo.js` (джерело істини — `vite.config.js` app-проєкту). Додатково сторінки тягнуть boot-модулі з side-effects (`session.js`, `user.js`, `openreplay.js`, auth-ланцюг `@nitra/vite-boot/user`). Кластер 3 цього не покривав (обмежувався маркером "лише display-стан" для мережевих компонентів).

### Considered Options

- **Чистий MSW** (`msw-storybook-addon`): усе мокання на network-рівні через service worker — query/mutation через `graphql.*`-хендлери, підписки через SSE-хендлер wire-протоколу graphql-sse; app-код не змінюється взагалі. Вибір користувача.
- **Link-рівневий мок через alias boot-модуля**: `resolve.alias` `src/njs/boot/apollo.js` → мок зі справжніми хуками `@vue3-apollo/core` і справжнім `ApolloClient`, але фейковим terminating `ApolloLink`-реєстром (`operationName → Observable/фікстура`). Рекомендація фасилітатора.
- **Гібрид MSW + boot-alias**: MSW для GraphQL, `resolve.alias` лише для side-effect boot-модулів. Компромісна рекомендація фасилітатора після вибору MSW.
- Повний модуль-мок `boot/apollo.js` (`useSubscription` → `ref(fixture)` без Apollo) — відкинуто: дублює/дрейфує семантику хуків.
- Реальний backend у docker / record-replay реальних SSE-фреймів — відкинуто як механізм (суперечить вимозі "без backend"); record-replay лишається як можливе джерело фікстур.

### Decision Outcome

Chosen option: **"Чистий MSW"** — мокання GraphQL (включно з підписками) виключно на network-рівні через `msw-storybook-addon`, без жодних `resolve.alias`-підмін app-коду, because це mainstream-шлях Storybook-екосистеми, app-код (включно з `apollo.js` і його link-split http/sse) лишається повністю справжнім, а мок-хендлери переносні між Storybook/vitest/playwright.

Facilitator recommended link-рівневий alias-мок (а після вибору MSW — гібрид MSW+boot-alias), because (1) SSE-підписки в MSW не мають готового `graphql.subscription()`-хендлера — потрібен ручний http-хендлер, зв'язаний із wire-протоколом graphql-sse (`event: next\ndata: …`, distinct-connection mode), який мовчки ламається при зміні транспорту; (2) boot-модулі з side-effects (openreplay-трекер, auth-ланцюг, session-boot) у чистому MSW стартують по-справжньому, і всі їхні запити теж треба мокати в MSW; user chose чистий MSW instead.

Супутні рішення (без розбіжностей):

- **Pinia**: справжня `createPinia()` у page-декораторі **без** `pinia-plugin-persistedstate` (`persist: true` стає no-op) + сідінг стану з `parameters.pinia.initialState`. Не `@pinia/testing` — воно стабить actions, а сторінка в Storybook має жити.
- **Router**: справжній `createMemoryHistory`-роутер із реальним параметризованим маршрутом (`/task/:id`), `router.push('/task/<id>')` перед mount + `await router.isReady()`; `id` — story-arg. Розширює наявний catch-all-рецепт Кластера 3 реальними params.
- **Vite-конфіг Storybook**: `viteConfigPath` на повний `vite.config.js` app-проєкту — `VueMacros` (сторінки використовують `$ref`), `AutoImport`, `quasar()` **лишаються**; знімаються лише `vite-plugin-pages`/`vite-plugin-vue-layouts` (story імпортує сторінку напряму). Це свідома дзеркальна асиметрія з `vitest.config.js` того ж проєкту (де плагіни знімають для ізоляції юнітів): два конфіги розв'язують різні задачі й не суперечать один одному.
- **Патерн story для сторінки**: wrapper-декоратор `QLayout`/`QPageContainer` (`q-page` кидає без layout-предка — невидима заздалегідь граблина рівня iconMapFn); одна фабрика `pageDecorator({ route, pinia })` для всього боїлерплейта; фікстури окремо в `.storybook/fixtures/<page>.js`; мок-сценарії — через `parameters.msw` (конвенція addon-а); smoke-мінімум — одна story "рендериться без помилок" на сторінку; окремі stories для loading/error/realtime (мультифреймовий SSE-сценарій).
- **Тригер (Кластер 1, закриває відкрите питання №1)**: app-проєкти детектяться за `vue` у `dependencies` + наявністю `src/pages/`; канон поширюється на них **другою хвилею** rollout (після обкатки на component-library пакетах), сторінкове покриття — smoke-рівень, без порога ≥3.

### Consequences

- Good, because app-код не змінюється взагалі — нуль ризику розійтись із production-поведінкою через мок-модулі; мок-хендлери MSW переносні в майбутні vitest browser-tests і playwright.
- Good, because рецепти Pinia/route-params закривають два типи залежностей, яких не було в жодній з попередніх реалізацій — наступний app-проєкт отримує їх готовими.
- Bad, because SSE-хендлер підписок зв'язаний із wire-протоколом graphql-sse — зміна транспорту (sse → ws) тихо ламає мок; потрібен канонічний хелпер-обгортка в скафолді, щоб протокол жив в одному місці.
- Bad, because у чистому MSW **всі** запити boot-модулів (openreplay, auth, session-boot) мають бути замокані хендлерами — msw-handlers файл app-проєкту ширший, ніж був би за гібридного підходу.

### More Information (розширення)

Сирий список ідей сесії розширення (51, по осях; для трасування):

**Вісь A — точка перехоплення Apollo:** alias усього `boot/apollo.js`; link-рівневий мок (справжні хуки + фейковий ApolloLink); `MockLink`/`MockSubscriptionLink` з `@apollo/client/testing`; MSW + `msw-storybook-addon`; мок `graphql-sse`-клієнта; підміна джерела в auto-import-конфізі; реальний backend у docker; record/replay SSE-фреймів у fixtures.

**Вісь B — семантика subscription-мока:** статичний `ref(fixture)`; керований стрім `operationName → [фрейми]` з інтервалом; Observable-мок за сценарієм; інтерактивний пуш фрейму кнопкою; окремі loading/error stories; пуш із `play()`; фікстури за `variables` (`$id`); schema-валідація фікстур проти `.graphqlrc.yml`.

**Вісь C — Pinia:** справжня `createPinia()` без persistedstate; `createTestingPinia` з `initialState`; alias `src/stores/*`; сідінг з `parameters.pinia.initialState`; окремий storage-неймспейс для persistedstate; args-driven store (локаль як контрол).

**Вісь D — Router:** memory-router з реальним `:id`-маршрутом + `isReady`; catch-all + params через provide; addon `storybook-vue3-router`; лишити `vite-plugin-pages` у Storybook; alias `vue-router` (відкинуто — ламає auto-import-пресет); `args.taskId` → push.

**Вісь E — Vite/Storybook-конфіг:** повний `vite.config.js` через `viteConfigPath` + overrides; задокументована асиметрія з `vitest.config.js`; зняти лише Pages/Layouts; `.env`-стратегія з фіктивними `VITE_*`; alias-мок теки `boot/`; no-op `openreplay.js`; мок `@nitra/vite-boot/user`; прототип в ізольованій пісочниці.

**Вісь F — патерн story:** `QLayout`-декоратор; фабрика `pageDecorator`; конвенція мок-реєстру за `operationName`; фікстури в `.storybook/fixtures/`; "золота" фікстура зі стейджа; рефакторинг сторінки на презентаційну+контейнер; smoke-мінімум; realtime-демо-story.

**Вісь G — governance:** новий ADR-файл vs правка цього (обрано правку цього файла stacked-гілкою поверх PR канону — уникнення дублю файла у двох PR); тригер app-проєктів зараз vs відкладено (обрано зараз); page-stories у vitest `storybook`-project; Stryker-виняток для page-stories; канонічна секція "мок-реєстр за operationName" у майбутньому правилі.

Відкриті питання розширення:
- Канонічна форма SSE-хендлера graphql-sse для MSW (хелпер у скафолді) — деталі реалізації, прототипом не перевірені: brainstorm-сесія свідомо без реалізації.
- Чи ганяти page-stories у vitest `storybook`-проєкті в CI, і чи виключати їх зі Stryker-скоупу.
- Схема мокання boot-запитів (session/auth/openreplay) у MSW — один спільний handlers-файл на app чи по-сторінково.
