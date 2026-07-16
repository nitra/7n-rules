# Changelog

## [1.2.2] - 2026-07-16

### Changed

- ♻️ refactor(rules): docs-only guide/ → per-concern директорії з реальними check/policy де можливо (#70)

## [1.2.1] - 2026-07-16

### Fixed

- Правило ga активується завжди (установка плагіна = вибір провайдера): у свіжому GitHub-репо без .github/workflows правило тепер вимагає створити канонічні workflow, а не мовчить

## [1.2.0] - 2026-07-16

### Added

- Mixin-концерни з ядра: lint_*_yml для js/python/docker/k8s/style/php/rust/security/text, npm_publish_yml, rust/toolchain_cache, abie/clean_merged_ignore_branches — GitHub-реалізація CI-lint намірів доменних правил

## [1.1.0] - 2026-07-15

### Added

- Перший реліз @7n/rules-ci-github: правило `ga` (канон GitHub Actions) винесено з ядра @7n/rules у плагін; capability `ci:github`

All notable changes to this project will be documented in this file.
