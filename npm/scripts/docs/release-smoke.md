---
type: JS Module
title: release-smoke.mjs
resource: npm/scripts/release-smoke.mjs
docgen:
  crc: 38d95c26
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Release-smoke: black-box перевірка ОПУБЛІКОВАНОГО npm-набору `@7n/rules` після кожного
релізу — «набір ПРАЦЮЄ з registry для споживача», а не «npm publish відпрацював».

Мотивація (двічі вистрелило в проді): (1) `@7n/rules-lang-php` тегнувся в git, але не
опублікувався в registry — `npm-publish` job був зелений (`continue-on-error` на publish-кроках,
spec npm-publish.yml), споживач отримував 404 при auto-install; (2) `KNOWN_PLUGIN_RANGES`
(`resolve-plugins.mjs`) вказували на legacy-лінії плагінів — новий core ставив старий
сумісний-за-API, але вже неактуальний minor. Жоден existing CI-крок цього не ловить: `npm
publish` перевіряє лише «команда відпрацювала», `bun run test` ганяє проти workspace
symlinks (той самий інсталяційний код завжди бачить локальні пакети, а не registry).

Дві фікстури — чисті tmp-проєкти з РЕАЛЬНИМ bun add -d `@7n/rules@latest` (реєстрова
інсталяція, без workspace:/file: посилань):
  - Фікстура A (JS + PHP + GitHub): composer.json присутній → auto-install
    `@7n/rules-lang-php`/`@7n/rules-lang-js`/`@7n/rules-ci-github`, `.n-rules.json` містить
    `php`+`ci_artifact`, `lint ci_artifact` матеріалізує `.github/workflows/lint-php.yml`
    байт-ідентичним canonical template з `node_modules/@7n/rules-lang-php`, `lint php --no-fix`
    не падає непередбачено.
  - Фікстура B (без composer.json): PHP-плагін і будь-які php-згадки відсутні.

Плюс версійна звірка реєстру: для кожного пакета з `KNOWN_PLUGIN_RANGES` встановленого core
(читаємо з `node_modules/@7n/rules` фікстури, НЕ з робочого дерева монорепо — застарілий
checkout не має бачити свіжий registry як зелений) published `dist-tags.latest` має
задовольняти range; сам core (`@7n/rules`) має мати доступний `dist-tags.latest`.

Запуск (CI, після `npm-publish`, або вручну): `node npm/scripts/release-smoke.mjs`. Мережевий
прогін проти живого registry — навмисно НЕ частина `bun run test` (те саме розділення, що
`smoke-check-imports.mjs`), лише окремий workflow `release-smoke.yml` і ручний e2e-прогін
`npm/scripts/tests/release-smoke.test.mjs` (`N_RELEASE_SMOKE_E2E=1`).

## Публічний API

- STEP_TIMEOUT_MS — Таймаут одного мережевого/CLI кроку (мс).
- BUN_ADD_RETRIES — Кількість повторів bun add -d `@7n/rules@latest` (registry-пропагація щойно опублікованого пакета).
- BUN_ADD_RETRY_DELAY_MS — Пауза між повторами `bun add` (мс).
- defaultNpmViewLatest — `npm view <pkg> dist-tags.latest` — опублікована latest-версія пакета.
- satisfiesKnownRange — Чи задовольняє опублікована версія caret-range з `KNOWN_PLUGIN_RANGES` (`^N` — весь major
`N`; `^0.N` — увесь `0.N.x`, npm-семантика caret для `0.x`-ліній). Формат ranges у таблиці
навмисно обмежений цими двома формами (див. коментар `resolve-plugins.mjs`), тож повний
semver-range-парсер тут не потрібен.
- bunAddWithRetry — `bun add -d <spec>` з ретраями (registry ще не встиг реплікувати щойно опублікований пакет).
- writeFixtureAFiles — Будує фікстуру A (JS + PHP + GitHub-сигнали) у `dir`: `package.json` (private,
`repository.url` на github.com), `composer.json` (`require.php`), мінімальний
`.github/workflows/ci.yml`.
- writeFixtureBFiles — Будує фікстуру B (JS + GitHub, БЕЗ composer.json) у `dir` — контроль негативного шляху:
без файлового PHP-сигналу плагін і будь-які php-згадки не мають з'явитись.
- readInstalledKnownPluginRanges — `KNOWN_PLUGIN_RANGES` ВСТАНОВЛЕНОГО у фікстурі core — динамічний import з
`node_modules/@7n/rules`, а не з робочого дерева монорепо (яке може бути застарілим щодо
щойно опублікованого core).
- checkVersionReconciliation — Версійна звірка registry: `core` має мати доступний `dist-tags.latest`; кожен пакет із
`knownRanges` має published `latest`, що задовольняє свій range у ВСТАНОВЛЕНОМУ core. Ловить
і «тегнули, не опублікували» (latest відсутній), і «range вказує на legacy-лінію» (latest є,
але не в діапазоні).
- checkFixtureADevDependencies — Перевірки Фікстури A після bun add -d `@7n/rules@latest` + `npx n-rules` (sync).
- checkFixtureAConfig — Перевірка `.n-rules.json` Фікстури A: `rules` містить `php` і `ci_artifact`.
- checkFixtureALintPhpYml — Перевірка `.github/workflows/lint-php.yml`, згенерованого `lint ci_artifact` — байт-ідентичний
canonical template з `node_modules/@7n/rules-lang-php/slots/ci/github/`.
- checkFixtureALintPhp — `lint php --no-fix` не має падати непередбачено (без стектрейсу необробленого винятку) — сам
exit code (0 при чистому composer.json, non-zero при violations) не фіксується жорстко, бо
залежить від composer-тулчейну CI runner-а (spec §10 Фаза 5 — задокументована поведінка, не
"не крашить" = "0").
- checkFixtureB — Перевірки Фікстури B: без composer.json PHP-плагін і будь-які php-згадки в `.n-rules.json`
не мають з'явитись.
- runFixtureA — Повний прогін Фікстури A: bun add → sync → devDependencies/config/ci_artifact/php-checks.
  (`retries`/`delayMs` — прокидаються у `bunAddWithRetry`, пришвидшує тести провалу install)
- runFixtureB — Повний прогін Фікстури B: bun add → sync → негативні перевірки (без PHP).
  (`retries`/`delayMs` — прокидаються у `bunAddWithRetry`, пришвидшує тести провалу install)
- main — Оркестрація повного release-smoke: Фікстура A (з версійною звіркою registry на її
встановленому core) → Фікстура B. Друкує кожен результат одразу (видимість у CI-логах
до завершення прогону).

## Сценарії використання

- `npm/scripts/tests/release-smoke.test.mjs` (satisfiesKnownRange; bunAddWithRetry) — ^N — весь major N; ^0.N — лише мінор N (0.x caret-семантика); невалідні version/range — false, без винятку; успіх з першого разу — без ретраїв; успіх після одного ретраю; ще 37

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `.github`, `.git`, `node_modules`.
