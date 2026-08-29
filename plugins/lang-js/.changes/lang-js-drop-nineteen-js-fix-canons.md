---
bump: minor
section: Removed
---

Знято девʼятнадцять JS-канонів T0-фікса — усі `rules/*/*/fix-<concern>.mjs`, чий фікс уже живе у wasm-гості `crates/plugin-lang-js`: `bun/layout`, `bun/licensee`, `js/check`, `js/doc_comments`, `js/jscpd_config`, `js/package_json`, `js/vscode_extensions`, `js-run/jsconfig`, `js-run/runtime`, `npm-module/emit_types_config`, `npm-module/npm_package_json`, `npm-module/root_package_json`, `style/lint`, `style/package_json`, `style/tooling`, `style/vscode_extensions`, `style/vscode_settings`, `test/storybook-ci`, `test/storybook-scaffold`. Разом із ними — сімнадцять тек `docs/`, допоміжний модуль `js/check/eslint-config.mjs` (його читав лише знятий `fix-check.mjs`) і десять характеризаційних тест-файлів. Гість відтоді ЄДИНА реалізація фіксу цих концернів, а не пріоритетна з JS-fallback-ом.

Спостережувана поведінка `--fix` не змінилась: гість і доти мав пріоритет (`T0Pattern.guestFix`). Джерела концернів — `.rego`, `concern.json`, `template/**`, `data/**`, `.mdc` — НЕ чіпані: їх гість вшиває `include_str!`-ом, і detect-парність лишається живою.

Практичний наслідок, який варто знати: fallback-у більше немає. Якщо wasm-компонент `lang-js` у консюмері не резолвиться (плагін не зібрано, розбіжність піна, хост без wasm), ці концерни деградують з «автофікс» у «порушення показано, концерн пішов у LLM-ладдер» — раніше цей випадок гасив JS-канон.

Чотири канони лишились, кожен зі своєю причиною: `bun/package_json` (§2.92 — концерн свідомо не портований), `test/storybook-vitest-config` (§2.87 — хірургічне редагування чужого `vitest.config.*`), `test/stryker_config` (портовано лише detect-половину — fix потребує повторного планування по дереву, чого napi-міст не дає) і `js/eslint`. Останній — знахідка цієї партії: канон гейтить на `bunx` лише `oxlint`, а `eslint --fix` кличе programmatic API (`new ESLint({ cwd, fix: true })`), тобто працює й без `bunx`; гість кличе обидва лінтери через `path:bunx`. Це реальна поведінка, якої гість не має, тож канон лишається робочим шаром драбини, а не залишком міграції.

Новий модуль `rules/test/storybook-scaffold/render.mjs` — сім рендерів шаблонів `.storybook/`, винесених зі знятого `fix-storybook-scaffold.mjs` дослівно: їх імпортує adopt-режим (`storybook-adopt/main.mjs`, `--fix-missing`), який у гість не портований.

Деталі й зразок — §2.93 / §2.88 `docs/plans/2026-08-05-open-questions-register.md`.
