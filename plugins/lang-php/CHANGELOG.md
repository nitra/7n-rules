# Changelog

## [0.3.0] - 2026-07-30

### Changed

- Повна заміна PHP-тулчейна на [mago](https://github.com/carthage-software/mago): `php-cs-fixer` →
`mago_fmt` (`mago format --dry-run`), `phpcs --standard=Security` → `mago_lint` (`mago lint`,
detect-only), PHPStan+Psalm у `project` → `mago analyze`. `composer audit` лишається
обов'язковим без змін. Security-parity з колишнім `phpcs --standard=Security` НЕ підтверджена —
задокументована фікстурами (`mago_lint/tests/fixtures/security/`).

## [0.2.8] - 2026-07-30

### Added

- Додано концерн `vscode_extensions` (Rego-gate `.vscode/extensions.json`, канон `bmewburn.vscode-intelephense-client`) — симетрія з lang-js/lang-rust/lang-python.

## [0.2.7] - 2026-07-30

### Changed

- feat(ci4): discover package knowledge impacts

### Fixed

- knowledge tests: використовують canonical `doc-files/package_knowledge` core path після злиття CI4.

## [0.2.6] - 2026-07-29

### Fixed

- tooling.mdc: прибрано подвійний порожній рядок наприкінці файлу (markdownlint MD012)

## [0.2.5] - 2026-07-29

### Fixed

- markdownlint: прибрано порожній рядок наприкінці rules/php/tooling/tooling.mdc

## [0.2.4] - 2026-07-29

### Changed

- Використання diffManifestDeps для порівняння залежностей composer.json

## [0.2.3] - 2026-07-29

### Changed

- Тест ci.artifact дескрипторів використовує спільний канон @7n/rules/scripts/utils/tests/ci-artifact-descriptor-tests.mjs (jscpd dedup з @7n/rules-lang-js)

## [0.2.2] - 2026-07-29

### Added

- php: додано concern composer_manifest (канон composer.json)
- PHP/Composer taze-провайдер (taze.provider@1, id taze-php) — детермінований bump composer require --with-all-dependencies по прямих require/require-dev, класифікація major/minor через caret-семантику; PHP-гілка SKILL.fragment.md
- doc-files.extensions і doc-files.extractor: PHP docblock-екстрактор без AST/запуску php (class/interface/trait/enum/function/public-методи)
- Провайдер coverage.provider@1 для PHP: PHPUnit/Pest clover-покриття (lines/functions) + опційне Infection mutation testing (caught/total, survived по файлах); collectPerFile — легкий делта-вимір per-file line coverage без мутаційки

### Changed

- Nested Composer workspace detection: `auto.glob` правила `php` тепер покриває глибину до 2
рівнів (`*/composer.json`, `*/*/composer.json`); `project`/`tooling` лишаються root-only —
задокументоване обмеження (ADR `2026-07-27-nested-composer-workspace-detection`)

## [0.2.1] - 2026-07-27

### Fixed

- Першу публікацію в npm registry розблоковано (publish-крок у CI був відсутній); peerDependency @7n/rules піднято до >=1.52.0

## [0.2.0] - 2026-07-27

### Added

- Перший реліз: правило `php` (PHPCS Security, PHP-CS-Fixer, PHPStan/Psalm, composer audit) перенесено з ядра `@7n/rules` (Фаза 4 spec universal-plugin-slots-lang-php-extraction) через `rules.directory@1`; три `ci.artifact@1` contributions постачають PHP-specific CI-артефакти без прямої залежності від `ci-github`/`ci-azure` — GitHub `lint-php.yml` (required-file), Azure lint-степ (contains-step, diagnostic-only), патч `lint-text.yml` (`**/*.php` у `push.paths`/`pull_request.paths`)

All notable changes to this project will be documented in this file.
