# Concern inventory для template-dir міграції

**Status: Accepted**
**Date:** 2026-05-17

Phase 0 deliverable до плану [`docs/superpowers/plans/2026-05-17-template-dir-phase-0-1.md`](../superpowers/plans/2026-05-17-template-dir-phase-0-1.md). Класифікація — за [специфікацією](../superpowers/specs/2026-05-17-template-dir-design.md), розділ «Класифікація концернів».

Категорії:

- **fragment** — merge-фрагмент на single JSON/TOML/YAML/jsonc; вираз через `<target>.snippet.<ext>` / `.deny.<ext>` / `.contains.<ext>`.
- **full-canon** — повний файл-канон (workflow `.yml`, `.gitleaks.toml`, `.stylelintignore`); template = subset-of цілого канону.
- **partial** — FS-existence/cross-file у JS + leaf-перевірка у template.
- **non-eligible** — cross-file / kustomize-resolution / kind-dispatching у мульти-doc YAML / параметризовані snippets з placeholder-ами (`<prefix>`, `<service>/<namespace>`) / file-walking з графом / version-range / AST-сканування / FS-walk.

Інвентаризація покриває всі концерни в `npm/rules/<id>/{fix,policy}/<concern>/` (об'єднує концерни з `target.json` та fix-only концерни без `target.json` — обидва типи потенційно вимагають template).

## Концерни з `target.json` (policy)

| rule | kind | concern | target | category | template-files-planned |
|---|---|---|---|---|---|
| abie | policy | base_deployment_preem | `**/k8s/**/base/**/*.yaml` (мульти-doc, kind-gated `Deployment`) | non-eligible | (none — multi-kind YAML, kind-dispatch у rego) |
| abie | policy | clean_merged_ignore_branches | `.github/workflows/clean-merged-branch.yml` | full-canon | `clean-merged-branch.yml.snippet.yml` |
| abie | policy | health_check_policy | `**/k8s/**/hc.yaml` (HealthCheckPolicy, derived `targetRef.name` з `metadata.name`) | non-eligible | (none — computed value derivation) |
| abie | policy | http_route_base | `**/k8s/**/base/**/hr.yaml` (HTTPRoute з regex-predicate на hostnames) | non-eligible | (none — domain-suffix regex) |
| adr | policy | settings_json | `.claude/settings.json` (hooks.Stop[].hooks[].command contains marker) | non-eligible | (none — substring у вкладеному масиві об'єктів, не на leaf string) |
| adr | policy | settings_local_json | `.claude/settings.local.json` (deny: hooks.Stop[].hooks[].command містить marker) | non-eligible | (none — символ deny — підрядок у вкладеному масиві об'єктів) |
| bun | policy | bunfig | `bunfig.toml` | fragment | `bunfig.toml.snippet.toml` (`[install].linker = "hoisted"`) |
| bun | policy | package_json | `package.json` (root, дозволено лише `@nitra/*` devDeps, dynamic lint-* aggregation) | partial | `package.json.deny.json` (packageManager, dependencies); aggregation lint-script лишається у rego |
| capacitor | policy | package_json | `package.json` (`@capacitor/core` version-range ≥ 8) | non-eligible | (none — semver range parsing) |
| docker | policy | lint_docker_yml | `.github/workflows/lint-docker.yml` | full-canon | `lint-docker.yml.snippet.yml` |
| docker | policy | package_json | `package.json` (`scripts.lint-docker` точне значення) | fragment | `package.json.snippet.json` |
| ga | policy | package_json | `package.json` (`scripts.lint-ga` має містити `n-cursor lint-ga`) | fragment | `package.json.contains.json` ✓ |
| ga | policy | vscode_extensions | `.vscode/extensions.json` (recommendations містить `github.vscode-github-actions`) | fragment | `extensions.json.snippet.json` ✓ |
| ga | policy | vscode_settings | `.vscode/settings.json` (`[github-actions-workflow].editor.defaultFormatter = "oxc.oxc-vscode"`) | fragment | `settings.json.snippet.json` ✓ |
| ga | policy | zizmor_yml | `.github/zizmor.yml` (`rules.unpinned-uses.config.policies."*" = "ref-pin"`) | fragment | `zizmor.yml.snippet.yml` ✓ |
| hasura | policy | svc_hl | `hasura/k8s/base/svc-hl.yaml` (`metadata.name` має закінчуватись на `-h`) | non-eligible | (none — suffix predicate, не leaf-equality) |
| image-avif | policy | package_json | `**/package.json` (`@nitra/minify-image.disable-avif` boolean) | partial | `package.json.deny.json` (typo `disabled-avif`); type-check значення лишається у rego |
| image-compress | policy | package_json | `package.json` (lint-image script, aggregator, deny deps) | fragment | `package.json.snippet.json` + `package.json.deny.json` + `package.json.contains.json` |
| js-bun-db | policy | package_json | `**/package.json` (deny `pg`/`pg-format`/`mysql2`) | fragment | `package.json.deny.json` |
| js-bun-redis | policy | package_json | `**/package.json` (deny `ioredis`/`node-redis`/`redis`/`@redis/*`) | fragment | `package.json.deny.json` |
| js-lint | policy | lint_js_yml | `.github/workflows/lint-js.yml` (uses/run substring scans, заборона `--fix`) | full-canon | `lint-js.yml.snippet.yml` |
| js-lint | policy | package_json | `package.json` (lint-js canonical, engines version-ranges, eslint-config min-version) | partial | `package.json.snippet.json` (type, lint-js, presence-keys); version-range перевірки лишаються у rego |
| js-mssql | policy | package_json | `**/package.json` (`mssql` ≥ 12.5.0) | non-eligible | (none — semver range parsing) |
| js-run | policy | configmap | `**/k8s/*/configmap.yaml` (`data.OTEL_RESOURCE_ATTRIBUTES` contains `service.name=`/`service.namespace=`) | fragment | `configmap.yaml.contains.yml` (на `data.OTEL_RESOURCE_ATTRIBUTES`) |
| js-run | policy | package_json | `**/package.json` (deny `bunyan`/`@nitra/bunyan` у deps і devDeps) | fragment | `package.json.deny.json` |
| k8s | policy | base_kustomization | `**/k8s/**/base/**/kustomization.yaml` (namespace непорожній + deny hpa/pdb у resources) | non-eligible | (none — kind-gating + список-substring-predicate) |
| k8s | policy | base_manifest | `**/k8s/**/base/**/*.yaml` (multi-kind, гнучкі вимоги до cluster-scoped vs namespaced) | non-eligible | (none — kind-set membership dispatch) |
| k8s | policy | gateway | `**/k8s/**/*.yaml` (multi-kind: HCP / route-kinds, backendRef walking) | non-eligible | (none — multi-kind dispatch + array walking) |
| k8s | policy | hpa_pdb | `**/k8s/**/*.yaml` (multi-kind HPA/PDB-gated) | non-eligible | (none — kind-gated, мульти-doc) |
| k8s | policy | kustomization | `**/k8s/**/kustomization.yaml` (resources sort-order + patches tuple-sort + JSON6902 op pairs) | non-eligible | (none — sort-order і pair-analysis у масивах) |
| k8s | policy | manifest | `**/k8s/**/*.yaml` (multi-kind: Ingress deny, Deployment containers walk, hasura image whitelist) | non-eligible | (none — multi-kind walking) |
| k8s | policy | svc_hl_yaml | `**/k8s/**/svc-hl.yaml` (`metadata.name` має -hl суфікс + clusterIP=None) | non-eligible | (none — suffix predicate на metadata.name) |
| k8s | policy | svc_yaml | `**/k8s/**/svc.yaml` (kind=Service + spec.type=ClusterIP) | non-eligible | (none — kind-gating потрібен у rego) |
| npm-module | policy | emit_types_config | `npm/tsconfig.emit-types.json` | fragment | `tsconfig.emit-types.json.snippet.json` |
| npm-module | policy | npm_package_json | `npm/package.json` (types regex pattern + files масив contains `"types"` + devDependencies має бути empty) | partial | `package.json.contains.json` (files contains `types`); regex types + empty-devDeps лишаються у rego |
| npm-module | policy | npm_publish_yml | `.github/workflows/npm-publish.yml` | full-canon | `npm-publish.yml.snippet.yml` |
| npm-module | policy | root_package_json | `package.json` (`workspaces` містить `"npm"`) | fragment | `package.json.contains.json` (`workspaces: ["npm"]`) |
| php | policy | lint_php_yml | `.github/workflows/lint-php.yml` (run contains `bun run lint-php`) | full-canon | `lint-php.yml.snippet.yml` |
| php | policy | package_json | `package.json` (`scripts.lint-php` присутній) | fragment | `package.json.snippet.json` |
| rego | policy | package_json | `package.json` (`scripts.lint-rego` точне значення `n-cursor lint-rego`) | fragment | `package.json.snippet.json` |
| rego | policy | vscode_extensions | `.vscode/extensions.json` (recommendations містить `tsandall.opa`) | fragment | `.vscode/extensions.json.snippet.json` |
| rego | policy | vscode_settings | `.vscode/settings.json` (`[rego].editor.defaultFormatter` + `formatOnSave`) | fragment | `.vscode/settings.json.snippet.json` |
| security | policy | package_json | `package.json` (lint-security canonical, aggregator contains, deny gitleaks у deps) | fragment | `package.json.snippet.json` + `package.json.deny.json` + `package.json.contains.json` (pilot) |
| style-lint | policy | lint_style_yml | `.github/workflows/lint-style.yml` | full-canon | `lint-style.yml.snippet.yml` |
| style-lint | policy | package_json | `package.json` (lint-style script contains `npx stylelint`, devDeps містить `@nitra/stylelint-config`, `stylelint.extends`) | fragment | `package.json.snippet.json` + `package.json.contains.json` |
| style-lint | policy | vscode_extensions | `.vscode/extensions.json` (recommendations містить `stylelint.vscode-stylelint`) | fragment | `.vscode/extensions.json.snippet.json` |
| style-lint | policy | vscode_settings | `.vscode/settings.json` (`css/less/scss.validate: false`) | fragment | `.vscode/settings.json.snippet.json` |
| text | policy | cspell | `.cspell.json` (version/language/import/ignorePaths subset) | fragment | `.cspell.json.snippet.json` + `.cspell.json.contains.json` (deny `@cspell/dict-*` через rego — substring у array; залишити inline) |
| text | policy | markdownlint | `.markdownlint-cli2.jsonc` | fragment | `.markdownlint-cli2.jsonc.snippet.jsonc` |
| text | policy | oxfmtrc | `.oxfmtrc.json` (required keys + canonical values + ignorePatterns subset) | partial | `.oxfmtrc.json.snippet.json` (canonical values + ignorePatterns); presence-only keys (`arrowParens` без значення) лишаються у rego |
| text | policy | package_json | `package.json` (Prettier deny + cspell-dict version-range) | partial | `package.json.deny.json` (prettier, markdownlint-cli2); version-range cspell-dict ≥ 2 лишається у rego |
| text | policy | vscode_extensions | `.vscode/extensions.json` (3 розширення у recommendations) | fragment | `.vscode/extensions.json.snippet.json` |
| text | policy | vscode_settings | `.vscode/settings.json` (formatOnSave + per-language defaultFormatter) | fragment | `.vscode/settings.json.snippet.json` |
| vue | policy | package_json | `**/package.json` (умовно: якщо `vue` у deps, `vite` ≥ 8 у devDeps) | non-eligible | (none — conditional gating + semver range) |

## Концерни без `target.json` (fix-only — JS-orchestrated)

| rule | kind | concern | target | category | template-files-planned |
|---|---|---|---|---|---|
| abie | fix | applies | (rule-applies gate) | non-eligible | (none — applies-gate, не check) |
| abie | fix | env_dns | `*.dev.env` / `*.ua.env` (cross-file URL parsing) | non-eligible | (none — text-parse + cross-file) |
| abie | fix | firebase_hosting | top-level subdirs FS-walk | non-eligible | (none — FS-walk + deny-existence) |
| abie | fix | hc_pairing | Deployment ↔ hc.yaml pairing FS-walk + modeline | non-eligible | (none — cross-file pairing) |
| abie | fix | ua_http_route | overlay HTTPRoute patch у ua/kustomization.yaml | non-eligible | (none — параметризований patch з placeholder-ами) |
| abie | fix | ua_node_selector | overlay nodeSelector patch у ua/kustomization.yaml | non-eligible | (none — параметризований inline-patch) |
| adr | fix | hooks | `.claude/hooks/*.sh` byte-hash compare + settings.json + .gitignore | non-eligible | (none — file-hash compare + cross-file) |
| bun | fix | layout | bun.lock/bunfig.toml/package.json FS-existence + .n-cursor.json cross-file | non-eligible | (none — FS-existence + cross-file) |
| capacitor | fix | platforms | Capacitor markers + version + iOS/Podfile checks | non-eligible | (none — cross-file gating + semver) |
| changelog | fix | consistency | git-base + npm-published mode + CHANGELOG parsing | non-eligible | (none — git/npm-registry-driven) |
| docker | fix | lint | Dockerfile/Containerfile walk + hadolint + multistage | non-eligible | (none — Dockerfile linting) |
| ga | fix | workflows | workflow on.paths via `git ls-files :(glob)` | non-eligible | (none — git-driven path validation) |
| graphql | fix | tooling | AST scan для `gql\`...\`` + .graphqlrc.yml existence | non-eligible | (none — AST scan через oxc-parser) |
| hasura | fix | internal_urls | `*.env` + svc-hl.yaml + namespace.yaml cross-file URL validation | non-eligible | (none — cross-file URL composition) |
| image-avif | fix | avif_generation | external CLI run + `.vue`/`.html` rewrite + sirota cleanup | non-eligible | (none — external tool orchestration) |
| image-compress | fix | package_setup | `.n-minify-image.tsv` + `.gitignore` legacy cleanup | non-eligible | (none — FS-existence + .gitignore content) |
| js-bun-db | fix | safety | AST scan для `new SQL`, `unsafe()`, pg-leftover | non-eligible | (none — AST scan через oxc-parser) |
| js-bun-redis | fix | imports | AST scan для `import/require` Redis-пакетів | non-eligible | (none — AST scan через oxc-parser) |
| js-lint | fix | tooling | `.oxlintrc.json` deep-canonical + ESLint flat + jscpd + workflow + engines | non-eligible | (none — embedded snapshot + multi-file orchestration; `.oxlintrc.json.snippet.json` потенційно можливий, але глибока structure + дозвіл доповнень) |
| js-mssql | fix | deps | AST scan для `new sql.ConnectionPool(...)` у функціях | non-eligible | (none — AST scan) |
| js-run | fix | runtime | AST: bunyan imports, process.env, #conn/* aliases, naming | non-eligible | (none — AST + naming-conventions) |
| k8s | fix | manifests | modeline + multi-kind walking + namespace/kustomize graph | non-eligible | (none — масивний cross-file walker, як приклад у specs) |
| nginx-default-tpl | fix | template | default.conf.template directive scan + Dockerfile + .ini placeholders | non-eligible | (none — text-template scanning + cross-file) |
| npm-module | fix | package_structure | npm/src AST walk + types layout + workflow + test-import scan у published files | non-eligible | (none — AST + FS walk + cross-file) |
| php | fix | tooling | composer.json + .github/workflows/lint-php.yml FS-existence | non-eligible | (none — FS-existence) |
| rego | fix | applies | (rule-applies gate: чи є `.rego` у дереві) | non-eligible | (none — applies-gate) |
| security | fix | gitleaks | `.gitleaks.toml` повний канон + package.json FS-existence | full-canon | `.gitleaks.toml.snippet.toml` (повний канон — pilot) |
| style-lint | fix | tooling | `.stylelintrc.*` / `stylelint.config.js` alternates + `.stylelintignore` | partial | `.stylelintignore` (text-only subset-of-lines, без `.snippet.` суфікса); FS-alternates лишаються у JS |
| tauri | fix | tooling | Tauri markers + delegate .vscode/extensions.json | non-eligible | (none — cross-file gating) |
| text | fix | formatting | `.v8rignore`, FS-existence multiple configs, lint-text validation, mdc text scan, workflow | non-eligible | (none — гетерогенний FS/markdown/script scan) |
| vue | fix | packages | Vue marker + vite-env.d.ts + jsconfig + AST scan `.vue`/`.ts`/`.js` | non-eligible | (none — AST через oxc-parser + FS) |

## Summary

Загалом: **85 концернів** (54 з `target.json`, 31 fix-only).

| категорія | кількість | приклади |
|---|---|---|
| **fragment** | 25 | `security.package_json`, `text.cspell`, `style-lint.vscode_settings`, `js-run.configmap`, `bun.bunfig`, усі 4 `ga.*` |
| **full-canon** | 7 | `security.gitleaks` (.gitleaks.toml), `js-lint.lint_js_yml`, `docker.lint_docker_yml`, `abie.clean_merged_ignore_branches` (workflows) |
| **partial** | 7 | `bun.package_json`, `style-lint/fix/tooling` (.stylelintignore), `npm-module.npm_package_json`, `text.oxfmtrc`, `text.package_json`, `image-avif.package_json`, `js-lint.package_json` |
| **non-eligible** | 46 | усі fix-only концерни з AST/FS-walk; всі k8s policy концерни (kind-dispatch / multi-kind YAML); version-range checks; параметризовані HTTPRoute з `<prefix>` |

**Сумарне покриття template-каталогами**: 39 з 85 концернів (fragment + full-canon + partial = 46% — тобто ~54% залишається inline у Rego/JS).

**Позначка `✓`** у колонці template-files-planned означає, що міграцію вже виконано (template/ файли створені, rego читає з `data.template.*`, mdc посилається маркдаун-лінками).

**Прогрес міграції:**

- Phase 1: `security` — pilot (`security.fix.gitleaks` full-canon + `security.policy.package_json` fragment). Покриває обидва шаблони інфраструктури.
- Phase 2: `ga` — усі 4 fragment-концерни (1.13.9).
- TODO: інвентаризація потребує доповнення для policy-концернів, доданих у 1.13.8 (`js-lint.jscpd`, `js-lint.vscode_extensions`, `security.policy.gitleaks` як дублікат до fix/gitleaks). Будуть додані разом із їх template-міграцією.
