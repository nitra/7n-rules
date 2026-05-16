# Перехід MDC-правил на `alwaysApply: false` + `globs`

**Status:** Accepted
**Date:** 2026-05-11

## Контекст

У пакеті `@nitra/cursor` 26 правил у `npm/mdc/` — переважна більшість мала `alwaysApply: true`, через що Cursor завантажував їх у контекст завжди, незалежно від того, які файли відкриті. Глоби існували лише в трьох правилах (`rego.mdc`, `docker.mdc`, `k8s.mdc`).

## Рішення/Процедура/Факт

Виконано класифікацію всіх правил на три групи:

- **Група A — файлово-чіткі** (10 правил): переведено на `alwaysApply: false` + `globs` — Cursor підтягує їх лише коли у контексті є відповідний файл за патерном.
- **Група B — проєктно-широкі** (`bun`, `npm-module`, `ci4`, `text`, `js-lint`): залишено `alwaysApply: true` — стосуються будь-якого файлу репо.
- **Група C — контент- або конфіг-залежні** (`abie`, `adr`, `js-bun-db`, `js-bun-redis`, `js-mssql`, `js-run`, `capacitor`, `tauri`): залишено без змін — вмикаються через `.n-cursor.json` або залежать від наявності імпорту/залежності, а не від розширення файлу.

Патчі застосовано до дзеркал у `.cursor/rules/n-*.mdc`; версія пакету піднята `1.8.229 → 1.8.230`.

Конкретні globs для Групи A:

| Правило | globs |
|---|---|
| `ga` | `.github/workflows/*.yml` |
| `vue` | `**/*.vue` |
| `php` | `**/*.php` |
| `style-lint` | `**/*.{css,scss,vue}` |
| `nginx-default-tpl` | `**/default.{conf.template,tpl.conf}` |
| `image-avif` | `**/*.{png,jpg,jpeg,gif,vue,html}` |
| `image-compress` | `**/*.{png,jpg,jpeg,gif,svg}` |
| `changelog` | `**/CHANGELOG.md, **/package.json` |
| `hasura` | `**/hasura/**, **/*.env` |
| `graphql` | `**/*.{vue,js,mjs,cjs,ts,tsx,jsx}` |

## Обґрунтування

Поля `globs` та `alwaysApply` в Cursor мають різну семантику: `alwaysApply: true` ігнорує `globs` і завжди займає місце в контексті. Коли правило стосується конкретного типу файлів, `alwaysApply: false` + `globs` є правильним режимом — контекст не витрачається, а правило все одно активується автоматично, коли відповідний файл відкривається в IDE.

## Розглянуті альтернативи

- Залишити `alwaysApply: true` для всіх — відхилено як марнотратство контексту Cursor-агента.
- Додати `globs` без `alwaysApply: false` — Cursor ігнорує `globs` при `alwaysApply: true`, тому це не має ефекту.

## Зачіпає

- `npm/mdc/{ga,vue,php,style-lint,nginx-default-tpl,image-avif,image-compress,changelog,hasura,graphql}.mdc`
- `.cursor/rules/{n-ga,n-vue,n-style-lint,n-changelog,n-image-avif,n-image-compress,n-nginx-default-tpl}.mdc`
- `npm/package.json`, `npm/CHANGELOG.md`
