# Changelog

## [0.0.8] - 2026-07-05

### Changed

- chore(demo): оновлено vite ^8.0.16 → ^8.1.3 (вимога vue/package_json ≥ 8.1)

## [0.0.7] - 2026-07-04

### Changed

- ADR_HOOKS_SKIP

## [0.0.6] - 2026-07-03

### Fixed

- fix(js): прибрано дубльований концерн js/jscpd (старий namespace js_lint.jscpd) — повний двійник js/jscpd_config по тому ж .jscpd.json; дубль давав два однакові заголовки в згенерованому n-js.mdc (MD024 у споживачах) і подвійну policy-оцінку
- fix(js): main.mdc — битий template-лінк на видалений js/jscpd (→ js/jscpd_config); синк правила js падав у споживачах на inlineTemplateLinks після 14.4.3
- fix(bun): @stryker-mutator/core додано в allowed_root_test_deps — vitest-runner@9 вимагає core як exact-pin peer явною залежністю; без цього bun/package_json та npm-module/npm_package_json заганяли споживача у глухий кут (root забороняє, workspace виганяє в root)

## [0.0.5] - 2026-07-03

### Changed

- demo: sync з оновленим інструментарієм

## [0.0.4] - 2026-06-08

### Changed

- @nitra/cursor 4

## [0.0.3] - 2026-06-05

### Changed

- demo: sync з оновленим інструментарієм

## [0.0.2] - 2026-06-01

### Changed

- demo: sync з оновленим інструментарієм

Усі помітні зміни пакета `demo` документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [0.0.1] - 2026-05-26

### Added

- Додано `vitest.config.js` baseline для приватного demo workspace відповідно до правила `test`.

## [0.0.0] - 2026-05-09

### Added

- Початковий каркас демо-пісочниці на Vue 3 + Vite (приватний воркспейс,
  не публікується). Призначення — перевірка правил `n-cursor` на живому
  Vue-проєкті: `vite.config.js` з `VueMacros` + `AutoImport` +
  `vite-plugin-vue-layouts-next`, `jsconfig.json`, `src/vite-env.d.ts`,
  скрипти `start` / `build` / `preview`.
