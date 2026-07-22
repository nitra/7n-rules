---
type: JS Module
title: eslint-config.mjs
resource: plugins/lang-js/rules/js/check/eslint-config.mjs
docgen:
  crc: 83a1762d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`renderEslintConfigScaffold` і `planEslintConfigFix` готують текстовий каркас `eslint.config` і план змін для монорепо та окремих воркспейсів, а `detectWorkspaceTypes` і `parseVueList` визначають, які частини конфігурації потрібні для конкретного workspace. Публічні якорі `ESLINT_CONFIG_MISSING`, `ESLINT_CONFIG_IGNORES`, `ESLINT_CONFIG_VUE_WORKSPACE` і `AUTO_IMPORTS_IGNORE` покривають відсутній конфіг, ігнори ESLint, Vue-workspace та виняток для `auto-imports.d.ts`. Шлях `node_modules` свідомо пропускається, а обробка помилок fail-safe: винятки не виходять назовні, і за окремих помилок повертається порожнє значення замість падіння.

## Поведінка

ESLINT_CONFIG_MISSING — позначає відсутній `eslint.config` і використовується як сигнал, що треба створювати scaffold замість merge.

ESLINT_CONFIG_IGNORES — маркер блоку `ignores`, куди вбудовується відсутній `AUTO_IMPORTS_IGNORE`, щоб зберегти автогенеровані `auto-imports.d.ts` поза перевіркою.

ESLINT_CONFIG_VUE_WORKSPACE — маркер секції `vue`, яка відокремлює Vue-воркспейси від Node-воркспейсів у згенерованому або виправленому конфігу.

AUTO_IMPORTS_IGNORE — спільне правило для ігнорування автогенерованих декларацій `**/auto-imports.d.ts`, яке додається лише якщо його ще немає в конфігу.

detectWorkspaceTypes бере `package.json` як джерело правди для `workspaces`, розгортає монорепо в список існуючих директорій або бере корінь як `.` для не-монорепо, а потім класифікує кожен workspace за Vue або Node. Перевірка Vue спирається на наявність `vue` чи `nuxt` у залежностях або на Vue-файли; шлях `node_modules` свідомо пропускається. Усі помилки гасяться, тому замість винятку повертається безпечний результат.

parseVueList читає вже наявний `eslint.config` і витягає з нього лише Vue-списки, щоб merge працював на реальному вмісті, а не на припущеннях.

renderEslintConfigScaffold використовує результати класифікації для побудови нового `eslint.config.js`, залишаючи тільки непорожні типи та підтримуючи порядок Node → Vue, якщо файл ще відсутній.

mergeEslintConfig виконує точкове оновлення існуючого конфігу: додає відсутній ignore для `AUTO_IMPORTS_IGNORE`, переносить Vue-воркспейси в `ESLINT_CONFIG_VUE_WORKSPACE`, і прибирає їх із Node-секції, не чіпаючи решту правил, коментарів чи кастомних `ignores`.

planEslintConfigFix обирає між scaffold і merge, залежно від того, чи є конфіг, і повертає лише один детермінований план дії; якщо дерево вже виправлене, результат порожній. Весь потік базується на `package.json` і завершується без записів у ФС чи БД з боку цього модуля.

## Публічний API

- ESLINT_CONFIG_MISSING — Відсутній eslint.config.{js,mjs} — T0 скаффолдить із детектованих типів.
- ESLINT_CONFIG_IGNORES — У ignores немає `**\/auto-imports.d.ts` — T0 дописує в наявний масив.
- ESLINT_CONFIG_VUE_WORKSPACE — Vue-воркспейс відсутній у `vue: [...]` getConfig — .vue файли не парсяться.
- AUTO_IMPORTS_IGNORE — Канонічний ignores-запис: згенерований `auto-imports.d.ts` у будь-якій теці.
- detectWorkspaceTypes — Класифікує репозиторій за воркспейс-типами для аргументів getConfig.
Монорепо (workspaces у root package.json) — кожен воркспейс окремо;
без workspaces — сам корінь як `.`.
- parseVueList — Vue-записи з тексту конфігу — для перевірки detector-ом.
- renderEslintConfigScaffold — Повний шаблон eslint.config.js для scaffold (файл відсутній). Включає лише
непорожні типи; порядок ключів — node, vue (стиль власного конфігу репо).
- mergeEslintConfig — Хірургічний merge наявного конфігу під детектовані типи:
  1) відсутній `**\/auto-imports.d.ts` → вставка в перший `ignores: [`;
  2) vue-воркспейси поза `vue: [...]` → вставка у список (або нова властивість
     одразу після `getConfig({`);
  3) ті самі воркспейси у `node: [...]` → вилучення звідти.
Решта файлу (кастомні ignores, overrides, коментарі) — недоторкана.
- planEslintConfigFix — План детермінованого фіксу eslint.config для T0: scaffold відсутнього файлу
або merge наявного. Ідемпотентний — повторний виклик на виправленому дереві
повертає null.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `node_modules`.
