---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/storybook/scope/main.mjs
docgen:
  crc: 04c71162
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:isVueComponentLibraryPkg,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає, які workspace-пакети мають потрапити в скоуп Storybook: спирається на `.n-rules.json`, `.n-cursor.json` і `package.json`, враховує opt-out, поріг Vue-файлів, стандартний build та окремий прапорець для app-проєктів. Також він fail-safe перевіряє, що `storybook.optOut` не містить посилань на неіснуючі пакети.

## Поведінка

- `VUE_FILE_THRESHOLD` задає мінімальну кількість Vue-файлів, після якої пакет може потрапити в скоуп Storybook.
- `readStorybookOptOut` читає з `.n-rules.json` або legacy `.n-cursor.json` перелік workspace-пакетів, які свідомо виключені зі скоупу Storybook; за відсутності або пошкодженості конфіга повертає порожній перелік.
- `readDetectAppsFlag` читає з `.n-rules.json` або legacy `.n-cursor.json` явний прапорець включення app-проєктів у детекцію Storybook; за замовчуванням лишає їх поза скоупом.
- `countVueFiles` рахує Vue-файли в дереві пакета з урахуванням шляхів, виключених конфігурацією і правилами ігнорування.
- `hasStandardBuild` визначає, чи має пакет підтримуваний Vite build-конфіг у корені, потрібний для канонічного Storybook setup.
- `isVueAppPkg` визначає, чи виглядає `package.json` як Vue app-проєкт, а не компонентна бібліотека.
- `collectInScopeVuePackages` збирає workspace-пакети зі стандартним build, достатньою кількістю Vue-файлів і без `storybook.optOut`; app-проєкти додає лише після явного увімкнення відповідного прапорця.
- `lint` перевіряє гігієну `storybook.optOut`: кожен запис має посилатися на наявний workspace-пакет, інакше звітує про застаріле налаштування.

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
- hasStandardBuild — Чи має пакет "стандартний" build — розпізнаваний `vite.config.{js,ts,mjs}` у корені пакета.
Канонічний `.storybook/main.js` спирається саме на цей файл (`viteFinal` мерджить його
плагіни) — без нього автоматичний скафолд неможливий, і пакет пропускається мовчки
(ADR Кластер 1: "skip пакетів із нестандартним build").
- isVueAppPkg — Чи є пакет app-проєктом (не бібліотекою) для хвилі 2: `vue` у `dependencies` (не лише
`peerDependencies`) і не бібліотека компонентів. Реалізовано зараз (щоб не переписувати
модуль пізніше), але результат впливає на скоуп лише за прапорця `storybook.detectApps`.
- collectInScopeVuePackages — Збирає workspace-пакети у скоупі канону Storybook хвилі 1: Vue-компонентна бібліотека
(`vue` у `peerDependencies`, маркер `isVueComponentLibraryPkg` — той самий, що й `vue.mdc`)
з не менше {@link VUE_FILE_THRESHOLD} `.vue`-файлами, без `storybook.optOut`, зі
стандартним build (`vite.config.*`). Хвиля 2 (app-проєкти) додається лише за явного
прапорця `storybook.detectApps` у `.n-rules.json`.
- lint — Self-check конфігурації: `.n-rules.json` → `storybook.optOut` не має посилатись на
неіснуючі workspace-пакети (застаріле налаштування — пакет перейменували/видалили, а
opt-out лишився). Сама детекція скоупу (поріг, build, app-проєкти) — pure-функції вище,
покриті тестами напряму; тут лише конфіг-гігієна.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
