# Changelog

## [1.2.1] - 2026-07-16

### Fixed

- Правило azure-pipelines активується завжди (установка плагіна = вибір провайдера): у свіжому Azure-репо без azure-pipelines.yml правило тепер вимагає створити pipeline, а не мовчить
- Mixin lint_pipeline_* приймають загальний full-прогін (`n-rules lint --no-fix --full`) як такий, що покриває доменний lint-степ — канонічний azure-pipelines.yml з одним full-степом задовольняє всі домени

## [1.2.0] - 2026-07-16

### Added

- Mixin-концерни `lint_pipeline_*` (js/python/docker/k8s/style/php/rust/security/text): Azure-реалізація CI-lint намірів — обов'язковий script-степ `n-rules lint … --no-fix` у azure-pipelines.yml

## [1.1.0] - 2026-07-15

### Added

- Перший реліз @7n/rules-ci-azure: правило `azure-pipelines` — базова структура azure-pipelines.yml (trigger/pool), обов'язковий lint-степ n-rules, розширення VS Code; capability `ci:azure`

All notable changes to this project will be documented in this file.
