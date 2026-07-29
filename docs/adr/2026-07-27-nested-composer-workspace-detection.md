---
type: ADR
title: "Nested Composer workspace detection для @7n/rules-lang-php"
---

# Nested Composer workspace detection для @7n/rules-lang-php

**Status:** Accepted
**Date:** 2026-07-27

## Context and Problem Statement

`docs/specs/2026-07-27-universal-plugin-slots-lang-php-extraction.md` §6 переносив PHP-правило
з `npm/rules/php/**` у `plugins/lang-php/rules/php/**` без behavioral rewrite і явно відклав
підтримку вкладених Composer-проєктів (монорепо на кшталт `services/api/composer.json`,
`backend/composer.json`) як «окреме рішення» — і плагінний автодетект
(`resolve-plugins.mjs:KNOWN_LANG_PLUGINS.php.maxDepth: 0`), і активація правила
(`plugins/lang-php/rules/php/main.json:auto.glob: "composer.json"`, без `**/`) лишались
root-only. Rust-плагін уже мав прецедент вкладеного детекту (`maxDepth: 3` — Tauri
`app/src-tauri/Cargo.toml`), тож потрібно було ухвалити симетричне рішення для PHP: на якій
глибині детектити, якою формою glob активувати правило (з урахуванням ризику хибного
спрацювання на негітігнорнутому `vendor/`), і чи поширювати `project`/`tooling` концерни
(`composer audit`, PHPStan, Psalm) на кожен знайдений вкладений проєкт, чи лишити їх root-only.

## Considered Options

- **Глибина автодетекту плагіна**: `maxDepth: 0` (лишити як є, root-only) vs `maxDepth: 2`
  (типові `services/api/composer.json`, `backend/composer.json`) vs `maxDepth: 3` (як rust,
  за прецедентом Tauri).
- **Форма `auto.glob` активації правила**: `"**/composer.json"` (необмежена глибина, повна
  довіра до `.gitignore`-фільтра в `collectTreePaths`) vs явний масив glob з фіксованою межею
  глибини (`["composer.json", "*/composer.json", "*/*/composer.json"]`).
- **Скоуп `project`/`tooling` концернів**: повний мультипроєктний прогін (`composer audit` +
  PHPStan + Psalm по кожному знайденому `composer.json` до межі глибини, з per-project
  `cwd`/reason-мапінгом у violation-reporter) vs збереження root-only читання з чесно
  задокументованим обмеженням; активація правила (сигнал «проєкт PHP») і глибина lint-перевірки
  (обсяг `project`/`tooling`) розводяться як окремі осі.

## Decision Outcome

Chosen option: **`maxDepth: 2` для автодетекту плагіна** (`resolve-plugins.mjs`), **явний масив
glob з фіксованою межею глибини** для активації правила (`["composer.json", "*/composer.json",
"*/*/composer.json"]`), і **root-only для `project`/`tooling`** з задокументованим обмеженням.

Глибина 2 покриває типові монорепо-кейси (`services/api/composer.json`,
`backend/composer.json`) без переходу на rust-прецедент (`maxDepth: 3`) — там глибина 3
обґрунтована конкретною структурою Tauri (`app/src-tauri/Cargo.toml`), для PHP-монорепо такого
третього рівня не спостерігається, а зайва глибина лише збільшує площу випадкового
спрацювання. `vendor` лишається у `LANG_SCAN_SKIP_DIRS` для автодетекту плагіна незалежно від
глибини.

Explicit glob-масив (а не `**/composer.json`) обраний після перевірки на фікстурі з
негітігнорнутим `vendor/`: `collectTreePaths` (`auto-rules.mjs`) повністю покладається на
`.gitignore` (через `globby({ gitignore: true })`) і **не** має власного skip-списку на кшталт
`LANG_SCAN_SKIP_DIRS` — якщо репозиторій не ігнорує `vendor/` (нетипово, але не заборонено),
`**/composer.json` підхопив би кожен вкладений пакет (`vendor/<org>/<pkg>/composer.json`) як
сигнал активації. Композерна структура вендор-пакетів завжди на глибині 3
(`vendor/<org>/<pkg>/composer.json`), тож явна межа глибини 2 убезпечує від цього кейсу
структурно — без залежності від стану `.gitignore` конкретного репозиторію. Це підтверджено
тестом `resolve-plugins.test.mjs` (`vendor/monolog/monolog/composer.json` не детектиться) і
симетричним тестом на активацію правила (`auto-rules.test.mjs`).

`project`/`tooling` лишаються root-only. Повний мультипроєктний прогін вимагав би: (а)
per-project `ctx.cwd` у кожному виклику `composer audit`/`vendor/bin/phpstan`/`vendor/bin/psalm`
(зараз обидва детектори жорстко читають корінь через голий `existsSync('composer.json')` і
`vendor/bin/<tool>` відносно `ctx.cwd`), (б) розширення `violation-reporter` полем «який проєкт»
у кожному violation, щоб CI-вивід лишався навіговним при кількох одночасних порушеннях у різних
підпроєктах, (в) окремого рішення про `vendor/bin/*` для кожного вкладеного проєкту (композерні
залежності вкладеного `services/api/composer.json` встановлюються у
`services/api/vendor/bin/*`, не в кореневий `vendor/bin/*`). Обсяг цієї роботи і ризик
regressions у вже стабільному `project`/`tooling` не виправданий цією задачею — активація
правила (сигнал «в репо є PHP-код») і глибина lint-перевірки (що саме прогострюється) свідомо
розведені як дві незалежні осі. `cs_fixer`/`phpcs` вже per-file `**/*.php` і покривають PHP-файли
будь-якого вкладеного проєкту без змін. Мультипроєктний `composer audit`/PHPStan/Psalm — можлива
майбутня робота, якщо з'явиться реальний PHP-монорепо в екосистемі.

### Consequences

- Good, because PHP-монорепо (композерний вкладений проєкт на глибині 1-2) тепер автоматично
  отримує активний плагін `@7n/rules-lang-php` і правило `php`, а `cs_fixer`/`phpcs` лінтять
  усі `.php`-файли незалежно від вкладеності.
- Good, because явна межа глибини (а не `**/`) структурно безпечна навіть на репозиторіях без
  `.gitignore`-запису для `vendor/` — підтверджено тестом на негітігнорнутій фікстурі.
- Bad, because `composer audit`/PHPStan/Psalm лишаються root-only: вкладений
  `services/api/composer.json` з відомою вразливістю в залежності НЕ підхоплюється
  `n-rules lint --full`, доки хтось не реалізує мультипроєктний прогін окремою задачею.
- Bad, because глибина 2 (а не 3, як rust) — гіпотетичний PHP-монорепо з третім рівнем вкладення
  (`packages/services/api/composer.json`) не задетектиться без ручного `plugins` у
  `.n-rules.json`; transcript не містить підтвердження, що такий кейс реально зустрічався.

## More Information

- `npm/scripts/lib/resolve-plugins.mjs` — `KNOWN_LANG_PLUGINS.php.maxDepth: 2`.
- `plugins/lang-php/rules/php/main.json` — `auto.glob` як явний масив трьох рівнів глибини.
- `plugins/lang-php/rules/php/tooling/tooling.mdc` — секція «Вкладені Composer-проєкти
  (монорепо)» з поясненням розведення активації і скоупу lint-перевірки.
- `plugins/lang-php/rules/php/project/main.mjs`, `plugins/lang-php/rules/php/tooling/main.mjs` —
  JSDoc-примітки про root-only обмеження.
- `npm/scripts/lib/tests/resolve-plugins.test.mjs`,
  `npm/scripts/tests/auto-rules.test.mjs` — тести глибини детекту й активації, включно з
  негітігнорнутою `vendor/`-фікстурою.
- `docs/specs/2026-07-27-universal-plugin-slots-lang-php-extraction.md` §6 — вихідне
  відкладення рішення.
