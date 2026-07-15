---
type: ADR
title: "Узгодження JS-прикладів та config-файлів з `.mjs`-конвенцією"
description: Після введення конвенції `.mjs`/`.cjs` нові source-приклади, test fixtures і підтримувані tooling-config імена узгоджуються з `.mjs`, не ламаючи backward-compat.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Після введення конвенції для нових JS-файлів — `.mjs` для ESM і `.cjs` для CommonJS замість голого `.js` — частина прикладів і checker fixtures у правилах лишалася на `.js`. Це створювало розбіжність між документаційною нормою та прикладами. Водночас деякі `.js`-імена були config-файлами тулінгу або були хардкоджені у чекерах, тому масове перейменування могло зламати узгодженість doc↔check.

## Considered Options

- Тільки додати секцію в `js-lint.mdc`, приклади не чіпати.
- Додати секцію в `js-lint.mdc` і переписати лише приклади нового вихідного коду («Кошик 2»), конфіги тулінгу лишити.
- Ширший рефактор: оновити приклади нового коду, релевантні fixtures, `vitest.config` baseline і checker support для `.mjs`/`.cjs`, зберігши backward-compat там, де він потрібен.

## Decision Outcome

Chosen option: "Ширший рефактор із backward-compat", because transcript фіксує, що приклади нового source-коду мають ілюструвати нову `.mjs`-конвенцію, а tooling, який реально підтримує `.mjs`/`.cjs`, не повинен без потреби тримати `.js` як єдиний канон.

### Consequences

- Good, because приклади нового вихідного коду в `js-run.mdc`, `js-bun-db.mdc`, `vue.mdc` показують `.mjs` і не суперечать конвенції.
- Good, because `vitest.config.mjs` стає каноном у baseline/checker tests, а runtime зберігає fallback на `vitest.config.js` для backward-compat.
- Good, because `stylelint.config.mjs` і `stylelint.config.cjs` розпізнаються чекером `style-lint` без помилки «Немає конфігу stylelint».
- Bad, because transcript не містить підтверджених негативних наслідків для переходу `vitest.config.js` → `vitest.config.mjs` і розширення `style-lint` checker support.
- Neutral, because конфіги тулінгу, які залишаються `.js` через вимоги або хардкод чекерів, потребують явного розрізнення від прикладів нового source-коду.

## More Information

- Конвенція додана в `npm/rules/js-lint/js-lint.mdc` як секція «Розширення нових файлів — `.mjs`/`.cjs`, не `.js`».
- Оновлені приклади нового source-коду: `npm/rules/js-run/js-run.mdc`, `npm/rules/js-bun-db/js-bun-db.mdc`, `npm/rules/vue/vue.mdc`.
- Свідомо не чіпали на першому етапі: `vite.config.js`, `vitest.config.js`, `eslint.config.js`, бо частина назв була привʼязана до checker logic.
- Для `vitest.config` рішення уточнено: `npm/rules/test/js/vitest-config-pool-forks.mjs` приймає `.mjs` і `.js`; `npm/rules/test/js/stryker_config.mjs` резолвить `vitest.config.mjs` із fallback на `vitest.config.js`.
- Baseline оновлено: `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs` і `stryker.config.vue.baseline.mjs` використовують `configFile: 'vitest.config.mjs'`.
- Для Stylelint: `npm/rules/style-lint/js/tooling.mjs` розширено на `stylelint.config.mjs` і `stylelint.config.cjs`; додано тест у `npm/rules/style-lint/js/tests/tooling.test.mjs`.
- Перевірки з transcript: 190 passed | 2 skipped для test-rule змін; 39 passed для style-lint змін.

## Update 2026-06-11

- Зафіксовано проміжне рішення «Кошик 2»: переписувати лише приклади нового вихідного коду (`src/conn/`, `src/utils/`, `store/`, `main.*`) на `.mjs`, не чіпаючи конфіги тулінгу.
- Після цього залишався відкритий нюанс: фікстури `js-run/js/tests/runtime/tests/check-fixture.test.mjs` ще містили `pg-write.js`, хоча документаційні приклади вже перейшли на `.mjs`.
- Перевірка після оновлення прикладів: `bunx vitest run scripts/lib/tests/inline-template-links.test.mjs …generated-markdown.test.mjs`, 22 тести, exit 0.

## Update 2026-06-11

- Додано рішення оновити інтеграційні фікстури `js-run/js/tests/runtime/tests/check-fixture.test.mjs` на `.mjs`, але залишити юніт-матрицю розширень без змін.
- Причина: `conn-file-rules.mjs` використовує `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u`, що приймає `.mjs`, а юніт-тест `conn-file-rules.test.mjs` навмисно покриває `.js/.ts/.mjs/.cjs/.mts` як backward-compat.
- Перейменовані фікстури: `pg-write.js` → `pg-write.mjs`, `mssql-write.js` → `mssql-write.mjs`, `lib/connections/pg-write.js` → `lib/connections/pg-write.mjs`.
- Перевірка після змін: 46 тестів пройшли.
