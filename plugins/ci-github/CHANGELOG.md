# Changelog

## [1.6.0] - 2026-07-18

### Added

- GA-автоміграція: T0-фікс service_deploy_workflow переписує deploy-*.yml до канону — job plan з outputs-мапінгом, легасі `lint --path` → per-domain lint-джоби (needs+if по outputs), перешивка needs, Skipped-толерантний if термінальних джоб; yaml Document API зберігає коментарі

## [1.5.0] - 2026-07-18

### Added

- Автоміграція: fix-хендлер lint_repo_yml — відсутній .github/workflows/lint-repo.yml створюється зі сніпета детермінованим T0-фіксом (`n-rules lint ga` у fix-режимі)

## [1.4.2] - 2026-07-18

### Fixed

- ga/workflows: await runConftestBatch у runAllGaRego — детектор падав з «violations is not iterable» після async seam (#109)

## [1.4.1] - 2026-07-18

### Fixed

- service_deploy_workflow: тригер-перевірка on.push.paths не бачила блок `on` після conftest-конвеєра YAML→JSON (bool-ключ YAML 1.1 серіалізується в рядок "true") — хибний deny «paths не містить glob» на валідних deploy-*.yml

## [1.4.0] - 2026-07-18

### Added

- сервіс-орієнтований CI-канон: концерн ga/service_deploy_workflow (форма `deploy-<service>.yml`: plan-гейт ci plan, per-domain lint-джоби з needs+if, deploy dependsOn всі перевірки) і ga/lint_repo_yml (окремий lint-repo.yml для repo-wide перевірок, що не гейтять деплой)

### Fixed

- ga/workflows: додано пропущені `await` для `runConftestBatch` (стала async у ядрі @7n/rules 1.14) — детектор падав із «violations is not iterable»

## [1.3.1] - 2026-07-18

### Fixed

- ga/workflows: `runConftestBatch` викликається з `await` — ядро зробило його async у @7n/rules 1.14 (#109), без await детектор падав «violations is not iterable» і валив увесь lint-прогін

## [1.3.0] - 2026-07-17

### Changed

- ga/workflow_common: дозволено режим release-серіалізації concurrency — статичний group + cancel-in-progress: false

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
