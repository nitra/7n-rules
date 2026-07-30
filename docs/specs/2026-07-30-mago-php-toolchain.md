# Заміна PHP-тулчейна `@7n/rules-lang-php` на mago

- Дата: 2026-07-30
- Статус: реалізовано
- Контекст: `@7n/rules-lang-php` тримав два дублюючі стеки статичного аналізу (PHPStan ∥
  Psalm) + окремі `php-cs-fixer`/`phpcs`, усі — опційні `vendor/bin`-тули з тихим skip

## Проблема

Чинний PHP-лінт (`cs_fixer`, `phpcs`, `project`) покладався на чотири окремі
`vendor/bin`-тули (`php-cs-fixer`, `phpcs`, `phpstan`, `psalm`), кожен зі своєю
PHP-composer-залежністю. Наслідки:

- **Клас «vendor tools absent → тихий skip».** Усі чотири — опційні: якщо проєкт не
  поставив `phpstan`/`psalm`/`php-cs-fixer`/`phpcs` через composer, детектор мовчки не
  дає порушень. Лінт може бути зеленим просто тому, що інструмент не встановлено.
- **Дубль PHPStan ∥ Psalm** — два аналізатори типів вирішують те саме завдання,
  подвійна конфігурація і час прогону без пропорційної вигоди.
- **PHP-рантайм-залежність.** Усі чотири тули — PHP-скрипти в `vendor/bin/`, тобто
  вимагають встановленого PHP + composer install у CI/локально ще до першого лінту.

[mago](https://github.com/carthage-software/mago) (`carthage-software/mago`) — standalone
Rust-бінарник: `format`/`lint`/`analyze` в одному тулі, без PHP-рантайму, встановлюється
через `ensure-tool` (як `hk`/`conftest`/`opa` — brew/GitHub Release, без composer).
`analyze` сумісний з PHPStan/Psalm-анотаціями (generics, flow narrowing).

## Мапа покриття (рішення користувача)

| Було | Стало | Примітка |
| --- | --- | --- |
| `php/cs_fixer` (`php-cs-fixer fix --dry-run --diff`) | `php/mago_fmt` (`mago format --dry-run`) | per-file, read-only |
| `php/phpcs` (`phpcs --standard=Security`) | `php/mago_lint` (`mago lint`, detect-only) | per-file, read-only, **без** `--fix` |
| `php/project`: PHPStan + Psalm | `php/project`: `mago analyze` (+ `--php-version` з `composer.json:require.php`, якщо розпізнано) | full-scope |
| `php/project`: `composer audit` | **без змін** | лишається обов'язковим, reason ids байт-у-байт ті самі |
| `php/tooling` | функціонально не чіпали | лише тексти (mago замість старих vendor-тулів) |
| `php/composer_manifest` | не чіпали | не пов'язано з лінт-тулчейном |

**Не покрито mago (лишається як є):** `composer audit`, `composer_manifest`, PHP 8.5
policy (Rector/PHPCompatibility, `php.mdc`/`tooling.mdc`), `taze`-провайдер (composer.json),
coverage-провайдер.

## Ризики

- **Security-parity не підтверджена.** Колишній `phpcs --standard=Security`
  (`php-security-audit`) і PHPStan/Psalm Taint Analysis явно цілилися в SQL injection /
  XSS / небезпечні функції через потік даних. mago — curated style/quality linter +
  типовий статичний аналізатор, **без** taint-аналізу. Зафіксовано 4 security-фікстурами
  (`plugins/lang-php/rules/php/mago_lint/tests/fixtures/security/`,
  `tests/security-fixtures.test.mjs`): на пін `mago@1.45.0` ловиться лише `eval()`
  (`no-eval`, error-рівень); SQL-конкатенація, XSS-echo, `shell_exec` з користувацьким
  вводом — **не ловляться** (лише стилістичні nit-и, exit 0). Тест — не asserion
  «має ловити», а живий знімок фактичної поведінки: апгрейд піна mago в
  `tool-pins.json` — привід перезапустити ці тести й побачити явну зміну покриття.
- **Швидкий дрейф 1.x.** mago — молодий проєкт (перший стабільний реліз недавно),
  `--minimum-fail-level`/rule-набір можуть змінюватись між minor-релізами. Пін —
  через штатний `tool-pins.json` (як і решта GitHub Release-тулів), рефреш —
  `tool-pins-refresh.mjs`.
- **Реліз mago тегується без префікса `v`** (`1.45.0`, не `v1.45.0`) — на відміну від
  усіх інших тулів у реєстрі `TOOLS`. `installFromGithub` у `ensure-tool.mjs` мав
  хардкод `v${ver}`; додано `entry.tagPrefix` (дефолт `'v'`, порожній для mago) —
  без цього Linux/Windows-fallback install зловив би 404.
- **`mago` — ensure-tool-керований, не vendor-optional.** На відміну від колишніх
  чотирьох тулів (тихий skip за відсутності), відсутність `mago` в PATH з вимкненим
  авто-install (`N_CURSOR_NO_AUTO_INSTALL=1`) — **hard-fail**, той самий патерн, що й
  `conftest`/`opa` (`run-conftest-batch.mjs`). Свідома зміна поведінки: mago завжди
  встановлюється (brew/GitHub Release), тож «відсутній» означає зламане середовище,
  не «проєкт не використовує цей тул».

## Верифікація CLI (реальний прогін, mago 1.45.0, macOS arm64)

- `mago format --check <path>` / `--dry-run <path>` — обидва read-only (не пишуть на
  диск), ненульовий exit якщо потрібне форматування; `--dry-run` додатково друкує diff
  у stdout (звідси вибір `--dry-run`, не `--check`, для змістовного violation-message).
- `mago lint <path>` — detect-only за замовчуванням (`--fix`/`--unsafe`/
  `--potentially-unsafe` — опційні, не застосовуються); дефолтний
  `--minimum-fail-level=error` — `warning`/`note`/`help` не впливають на exit code.
- `mago analyze <path>` — статичний аналіз типів; `--php-version <X.Y>` — **глобальний**
  прапор (`mago --php-version 8.5 analyze …`, ПЕРЕД підкомандою — після підкоманди CLI
  відмовляє з `unexpected argument`).
- GitHub Release asset: `mago-<ver>-<arch>-unknown-linux-gnu.tar.gz`
  (`x86_64`/`aarch64` — той самий arch-стиль, що й `hk`/`shellcheck`), бінарник
  всередині — у підкаталозі `mago-<ver>-<arch>-unknown-linux-gnu/mago`, не в корені
  архіву.

## Реалізація

- `npm/scripts/lib/ensure-tool.mjs`: `TOOLS.mago` (brew `mago`, GitHub Release
  fallback, `scoop: null` — немає manifest-у в ScoopInstaller/Extras), `tagPrefix: ''`;
  `npm/scripts/lib/tool-pins.json`: `"mago": "1.45.0"`.
- `plugins/lang-php/rules/php/mago_fmt/` — новий концерн (`mago format --dry-run`,
  reason `mago-fmt-unformatted`), замінює видалений `cs_fixer/`.
- `plugins/lang-php/rules/php/mago_lint/` — новий концерн (`mago lint`, reason
  `mago-lint`), замінює видалений `phpcs/`; security-фікстури в `tests/fixtures/security/`.
- `plugins/lang-php/rules/php/project/main.mjs` — PHPStan/Psalm-блоки видалено,
  додано `mago analyze` (reason `mago-analyze`) з опційним `--php-version` із
  `composer.json:require.php` (`extractPhpVersion`, regex-екстракція першого `X.Y`).
- `plugins/lang-php/rules/php/tooling/tooling.mdc` — тексти оновлено (mago замість
  vendor-тулів), функціональність `tooling/main.mjs` не змінено.
- `npm/scripts/lib/resolve-plugins.mjs`: `KNOWN_PLUGIN_RANGES['@7n/rules-lang-php']`
  `'^0.2'` → `'^0.3'`.

## Верифікація

- Unit: `mago_fmt/tests/main.test.mjs`, `mago_lint/tests/main.test.mjs`,
  `project/tests/main.test.mjs` — мокані `ensureToolAsync`/`spawnAsync`, happy-path,
  violation-парсинг (реальний формат виводу mago, знятий ручним прогоном), non-zero
  exit, `--php-version` з/без `composer.json:require.php`.
- Hard-fail: `mago_fmt/tests/main-hard-fail.test.mjs`,
  `mago_lint/tests/main-hard-fail.test.mjs` — `withBinRemovedFromPath('mago', …)`,
  реальний `ensureToolAsync` (без моків), `lint()` кидає, не тихий skip.
- Integration (`describe.skipIf(!hasMago)`, патерн `hasConftest`):
  `mago_fmt/tests/main-integration.test.mjs`, `mago_lint/tests/main-integration.test.mjs`
  — реальний `mago` на tmp-фікстурі (форматований/неформатований, чистий/синтаксично
  битий файл).
- `ensure-tool.test.mjs`: `buildGithubDownloadUrl` — regression-тест на 404 з
  `v`-префіксом (mago tag без `v`).
