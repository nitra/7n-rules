---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/js/check/main.mjs
docgen:
  crc: 59674b79
  model: manual
---

## Огляд

Detector concern-а `js/check`: read-only перевірка відповідності проєкту правилам
`js.mdc`. Накопичує порушення через violation-reporter і повертає їх runner-у;
нічого не друкує і нічого не пише.

## Поведінка

- `eslint.config.js`/`eslint.config.mjs`: файл існує (інакше reason
  `eslint-config-missing`), містить `getConfig` та імпорт `@nitra/eslint-config`,
  в ignores є `**/auto-imports.d.ts` (reason `eslint-config-ignores`).
- Воркспейс-типи: кожен vue-воркспейс (детекція з `eslint-config.mjs` — root
  `workspaces` + vue/nuxt-залежність або `.vue` файли) має бути у `vue: [...]`
  аргументах `getConfig`, інакше reason `eslint-config-vue-workspace` — без
  цього eslint не парсить `.vue` файли воркспейсу. Ці три reason-и детерміновано
  виправляє T0 `fix-check.mjs`.
- Кожен workspace `package.json`: `"type": "module"`, `engines.node >= 24`,
  `engines.bun >= 1.3` (кореневий `package.json` валідує Rego
  `npm/policy/js_lint/package_json/`).
- `.oxlintrc.json`: існує, валідний JSON, збігається з каноном oxlint із пакета
  `@7n/rules` (`verifyOxlintRcAgainstCanonical` з `../tooling/main.mjs`).
  Відсутність — reason `oxlintrc-missing`, розходження з каноном — reason
  `oxlintrc-drift` (константи `OXLINTRC_MISSING`/`OXLINTRC_DRIFT`); обидва
  детерміновано виправляє T0 `fix-check.mjs` (патерн `js-check-oxlintrc`).
- `.github/workflows/lint-js.yml`: існує; `lint.yml` (якщо є) не дублює
  oxlint/eslint/jscpd кроки.
- `knip.json`: існує — reason `knip-missing` за відсутності; вміст наявного
  файлу локально не валідується. Копію канонічного baseline робить T0
  `fix-check.mjs` (патерн `js-check-knip`), а НЕ детектор: до 2026-08-01
  копіювання жило прямо у фазі detect і звітувало `pass`, тож порушення було
  неспостережуваним, а `lint --no-fix` мутував дерево (спека
  `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення Ґ).
- Застарілі конфіги ESLint (`.eslintrc`, `.eslintrc.js`, `.eslintrc.json`,
  `.eslintrc.yml`) — порушення: лише flat config.

## Публічний API

- `lint(ctx)` → `LintResult` — перелік порушень concern-а.

## Гарантії поведінки

- Повністю read-only: жодна перевірка не пише у ФС (усі мутації — у T0
  `fix-check.mjs`).
- Порушення повертаються reporter-ом, не друкуються.
