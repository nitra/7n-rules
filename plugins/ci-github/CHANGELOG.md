# Changelog

## [2.3.2] - 2026-08-25

### Fixed

- ga-політики стали незалежними від версії YAML-парсера: читання події workflow-а тепер object.get(input, "on", object.get(input, "true", {})) у всіх пʼятьох пакетах (було лише в lint_ga). Під conftest вивід не змінився; без цього будь-який YAML-1.2-парсер зробив би три пакети тихо непрацездатними. sprintf %q замінено на \"%v\" — байт-у-байт той самий текст

## [2.3.1] - 2026-08-19

### Changed

- дозволено preinstalled ci-tools у lint-ga policy

## [2.3.0] - 2026-08-01

### Added

- `ga/workflow_common`: маркер `n-rules:allow-<pattern>` у тілі кроку знімає заборону конкретного підрядка саме для цього кроку — потрібно там, де composite `setup-bun-deps` принципово не підходить (він робить `--frozen-lockfile`, а крок навмисно перегенеровує lock)

## [2.2.1] - 2026-07-30

### Changed

- release: @7n/rules@1.59.0, @7n/rules-ci-github@2.2.0, @7n/rules-lang-js@0.25.2, @7n/rules-lang-php@0.2.8, @7n/rules-lang-python@0.12.2, @7n/rules-lang-rust@0.15.2; fix(plugins): audit follow-ups — php vscode extensions, llm-lib peers, lint-style vue patch (#307)

## [2.2.0] - 2026-07-30

### Removed

- Прибрано `**/*.vue` з `paths` канонічного `lint-style.yml.snippet.yml` — цей глоб виїхав у `@7n/rules-lang-js` (`ci.artifact` patch-existing слот `js-lint-style-patch`), той самий патерн, що й `lint-text.yml` у хвилі 3A.

## [2.1.0] - 2026-07-29

### Removed

- text/lint_text: прибрано хардкод JS/TS/Vue/Python globs зі static template — тепер їх додають lang-js/lang-python через ci.artifact patch-existing (поведінка збережена при активних плагінах)
- Видалено js-специфічні CI-концерни (lint_js_yml) — власність перенесена в @7n/rules-lang-js через ci.artifact@1 contribution
- Rust GitHub CI-канон (lint-rust.yml) винесено в @7n/rules-lang-rust ci.artifact@1 contribution — обслуговує generic ci.artifact consumer
- Python-специфічні CI-артефакти (rules/python/lint_python_yml) видалено — тепер @7n/rules-lang-python own них через ci.artifact@1 contribution, обслуговується generic consumer-ом

## [2.0.2] - 2026-07-28

### Changed

- release: @7n/llm-lib@2.10.1, @7n/rules@1.52.1, @7n/rules-lang-js@0.23.1
- Механічно додано change-файл для поточних змін у workspace.

## [2.0.1] - 2026-07-27

### Fixed

- peerDependency @7n/rules піднято до >=1.52.0 — перша core-версія з universal slot bus (plugin API v2)

## [2.0.0] - 2026-07-27

### Added

- Generic ci.artifact@1 consumer: deep-subset merge, GitHub Actions workflow artifacts (required-file/patch-existing), T0-фікс

### Changed

- Маніфест плагіна переведено на universal slot bus (`requiresPluginApi: 2`, `slots.provides` з `rules.directory@1` замість `contributes.rules`) — spec 2026-07-27-universal-plugin-slots-lang-php-extraction, Фаза 2.

### Removed

- PHP-specific mixin-концерн `rules/php/lint_php_yml/**` видалено (Фаза 4 spec universal-plugin-slots-lang-php-extraction) — GitHub `lint-php.yml` тепер обслуговує generic `ci.artifact@1` consumer через contribution `@7n/rules-lang-php`; статичний `lint-text.yml` template більше не містить безумовний `**/*.php` glob — тепер `patch-existing` contribution того самого плагіна

## [1.9.8] - 2026-07-26

### Fixed

- GA workflow validation дозволяє canonical optional language config paths до появи самих конфігів.

## [1.9.7] - 2026-07-25

### Changed

- Оптимізовано path-фільтри lint workflow для pull request

## [1.9.6] - 2026-07-24

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.9.5] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.9.4] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.9.3] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.9.2] - 2026-07-22

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [1.9.1] - 2026-07-22

### Fixed

- GH Actions canon: заквотувати $GITHUB_PATH у lint-k8s.yml і git-ai.yml.snippet.yml (SC2086 deadlock з ga/workflows-лінтом); гейт-тест template/*.yml.snippet.yml через actionlint

## [1.9.0] - 2026-07-20

### Added

- service_deploy_workflow: bootstrap-режим міграції (`migrateWorkflowFile(..., { bootstrap: true })`) — для deploy-workflow без жодної lint-джоби (валідний as-is за rego) створює lint-джоби доменів з нуля і підключає вхідну джобу до plan + усіх lint-джоб; опційний опт-ін, не частина звичайного lint --fix

## [1.8.0] - 2026-07-20

### Added

- service_deploy_workflow: перевірка outputs-мапінгу plan-джоби — кожен ключ гейта `needs.plan.outputs.<key>` має бути задекларований у `jobs.plan.outputs` і вказувати на `steps.<id>.outputs.<key>` реального кроку (інакше гейт тихо порожній і джоба скіпається завжди)

## [1.7.1] - 2026-07-19

### Changed

- release: @7n/rules@1.27.0, @7n/rules-lang-js@0.3.0, @7n/rules-lang-python@0.5.1, @7n/rules-lang-rust@0.5.1

## [1.7.0] - 2026-07-18

### Changed

- service_deploy_workflow: дискримінатор за ЗМІСТОМ замість імені deploy-*.yml (дзеркало ci-azure) — сервісний workflow визначається dir-scoped глобом `on.push.paths` (`npm/**`), імʼя довільне (npm-publish.yml завʼязаний на OIDC trusted publishing — перейменування ламає публікацію); plan-гейт вимагається лише за наявності lint-джоб

## [1.6.2] - 2026-07-18

### Changed

- Оновлено plugins/ci-github.

## [1.6.1] - 2026-07-18

### Changed

- fix-service_deploy_workflow: `parseNRulesCmd`/`relevantDomains` перенесено в спільний `@7n/rules/scripts/lib/lint-surface/ci-plan.mjs` (jscpd-дублікат із ci-azure), без зміни поведінки

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
