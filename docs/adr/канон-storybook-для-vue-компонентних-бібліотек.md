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
- Чи розширювати скоуп на app-проєкти (`demo/`-подібні), чи лишити тільки component-library пакети.
- Порт `storybook dev` при кількох Vue-пакетах в одному монорепо (фіксований vs авто-інкремент).
- Чи є в nitra-екосистемі інші типові зовнішні залежності (крім router/Apollo/tfm), які варто покрити canonical-рецептами заздалегідь.
- Хто саме рев'юїть LLM-згенеровані stories перед мержем (хвиля 2) — окремий чекліст у PR-темплейті чи звичайний code review.
