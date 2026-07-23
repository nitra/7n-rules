# Changelog

## [1.4.7] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.4.6] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.4.5] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.4.4] - 2026-07-22

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.4.3] - 2026-07-19

### Changed

- release: @7n/rules@1.27.0, @7n/rules-lang-js@0.3.0, @7n/rules-lang-python@0.5.1, @7n/rules-lang-rust@0.5.1

## [1.4.2] - 2026-07-18

### Changed

- fix-service_deploy_pipeline: `parseNRulesCmd`/`relevantDomains` перенесено в спільний `@7n/rules/scripts/lib/lint-surface/ci-plan.mjs` (jscpd-дублікат із ci-github), без зміни поведінки

## [1.4.1] - 2026-07-18

### Fixed

- service_deploy_pipeline під реальну efes-форму: template-параметр покриває сервіс за префіксом glob-а (`run/nexus/**` ↔ modulePath `run/nexus`, було — хибний deny на всіх extends-пайплайнах); plan-гейт вимагається лише за наявності lint-джоб (утилітарні service-scoped pipelines типу gen:schema — поза каноном); команди читаються і з кроків `task: Bash@3` (`inputs.script`) — у rego і в автомігратора

## [1.4.0] - 2026-07-18

### Added

- Автоміграція легасі сервіс-pipeline-ів до канону: T0-фікс service_deploy_pipeline переписує `.azurepipelines/**` (job plan, легасі `lint --path` → per-domain `lint_<key>` по файлах піддерева, перешивка dependsOn і Skipped-толерантні condition) через yaml Document API зі збереженням коментарів

## [1.3.0] - 2026-07-18

### Added

- Сервіс-орієнтований CI-канон: концерн azure-pipelines/service_deploy_pipeline — форма per-service pipeline у .azurepipelines/ (plan-гейт `ci plan --azure`, per-domain lint-джоби з dependsOn+condition, термінальні джоби зі Skipped-толерантним condition)

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
