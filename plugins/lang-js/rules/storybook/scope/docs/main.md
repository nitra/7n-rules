---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/storybook/scope/main.mjs
docgen:
  crc: b6af79b3
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:isVueComponentLibraryPkg,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає, які workspace-пакети потрапляють до Storybook-скоупу, спираючись на `.n-rules.json`, `.n-cursor.json` і `package.json`. Він читає ці конфіги, щоб відрізняти Vue-пакети від інших app-проєктів, зокрема через `isVueAppPkg`, `countVueFiles` і `collectInScopeVuePackages`, а поріг для Vue-скоупу задає `VUE_FILE_THRESHOLD`. Додатково він враховує `readStorybookOptOut`, `readDetectAppsFlag` і `lint` як частину публічної поведінки. Усі помилки обробляються fail-safe: назовні не кидаються винятки, а за певних помилок повертається порожнє значення, наприклад `null`.

## Поведінка

- `VUE_FILE_THRESHOLD` — задає мінімальну кількість `.vue`-файлів для бібліотек у скоупі Storybook.
- `readStorybookOptOut` — читає список workspace-коренів, які треба виключити зі скоупу Storybook, з `.n-rules.json` або legacy `.n-cursor.json`; за відсутності або невалідності конфігів повертає порожній список.
- `readDetectAppsFlag` — читає прапорець `storybook.detectApps` з `.n-rules.json` або `.n-cursor.json`; якщо прапорець не заданий або конфіг не читається, вважає його вимкненим.
- `countVueFiles` — рахує `.vue`-файли в дереві пакета з урахуванням ігнорів, щоб оцінити його придатність для Storybook.
- `isVueAppPkg` — визначає, чи пакет схожий на Vue app-проєкт, а не на компонентну бібліотеку.
- `collectInScopeVuePackages` — збирає workspace-пакети, які входять у скоуп Storybook: бібліотеки — завжди за порогом `.vue`-файлів, app-проєкти — лише коли увімкнено `storybook.detectApps`, і без цього порога.
- `lint` — перевіряє, що `storybook.optOut` не посилається на неіснуючі workspace-пакети, і повертає результат без падіння на помилках читання конфігів.

Changelog: не запускався

## Публічний API

- VUE_FILE_THRESHOLD — Поріг кількості `.vue`-файлів для скоупу канону Storybook (ADR Кластер 1).
- readStorybookOptOut — Читає `storybook.optOut` з `.n-rules.json` (fallback — legacy `.n-cursor.json`). Толерантно до
відсутнього файлу/поля/невалідного JSON — повертає порожній масив (open-by-default, як
`read-n-rules-config-lite.mjs`). Значення — root dir пакетів (`.` для кореня, `packages/ui` тощо),
той самий формат, що повертає `getMonorepoPackageRootDirs`.
- readDetectAppsFlag — Читає прапорець хвилі 2 `storybook.detectApps` з `.n-rules.json`. За замовчуванням `false` —
детекція app-проєктів (`vue` у dependencies + `src/pages/`) лишається відкритим питанням ADR
і не впливає на скоуп, доки консюмер-репо не увімкне прапорець явно.
- countVueFiles — Рахує `.vue`-файли в дереві пакета (поважає `.gitignore` й `ignore` з `.n-rules.json` через
`walkDir`/`ignorePaths` — той самий обхід, що й `vue/packages`).
- isVueAppPkg — Чи є пакет app-проєктом (не бібліотекою) для хвилі 2: `vue` у `dependencies` (не лише
`peerDependencies`) і не бібліотека компонентів. Реалізовано зараз (щоб не переписувати
модуль пізніше), але результат впливає на скоуп лише за прапорця `storybook.detectApps`.
- collectInScopeVuePackages — Збирає workspace-пакети у скоупі канону Storybook: Vue-компонентна бібліотека хвилі 1
(`vue` у `peerDependencies`, маркер `isVueComponentLibraryPkg` — той самий, що й `vue.mdc`)
з не менше {@link VUE_FILE_THRESHOLD} `.vue`-файлами, без `storybook.optOut` — тип `library`.
Наявність `vite.config.*` пакета — НЕ умова скоупу (rollout tauri-components/npm, хвиля 1.4):
канонічний скафолд (`viteConfigPath` на `empty-vite.config.js`, `loadConfigFromFile`
толерує відсутній конфіг) працює й для source-only Vue-бібліотек без власного Vite-білду
— див. секцію "Скоуп" у `main.mdc`.

Опційно (лише за `storybook.detectApps: true` у `.n-rules.json`) — app-проєкти хвилі 2a:
`vue` у `dependencies` (не бібліотека) + наявний `src/pages/` — тип `app`, свідомо
**без** порога {@link VUE_FILE_THRESHOLD} (ADR-розширення 2026-07-20: сторінкове покриття —
smoke-рівень, поріг відсікав би легітимні app-проєкти з 1-2 сторінками).
- lint — Self-check конфігурації: `.n-rules.json` → `storybook.optOut` не має посилатись на
неіснуючі workspace-пакети (застаріле налаштування — пакет перейменували/видалили, а
opt-out лишився). Сама детекція скоупу (поріг, app-проєкти) — pure-функції вище,
покриті тестами напряму; тут лише конфіг-гігієна.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
