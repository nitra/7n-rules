# Changelog

Усі помітні зміни цього модуля документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.9.8] - 2026-05-12

### Changed

- **Корінь монорепо:** у `eslint.config.js` після `...getConfig(...)` додано перевизначення `sonarjs/cognitive-complexity` на `['warn', 20]` (поріг 20, severity `warn`).

## [1.9.7] - 2026-05-12

### Changed

- **js-lint (mdc v1.18 → v1.19) — `depcheck` мігровано на `knip`:** канонічний `lint-js` тепер `bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip` (раніше — без `bunx knip`); крок `bunx knip` додано і в приклад workflow `lint-js.yml`. У корені має бути `knip.json` з мінімальним `ignoreDependencies: ["graphql"]` (peer-залежність, яку `knip` не розпізнає як використану). Пакет `knip` окремо в `devDependencies` не оголошуй — `bunx` тягне його ad-hoc. `CANONICAL_LINT_JS` у `npm/scripts/check-js-lint.mjs` і `canonical_lint_js` у `npm/policy/js_lint/package_json/package_json.rego` оновлено; додано `checkKnipConfig` (наявність файла + `ignoreDependencies` містить `graphql`) і `deny`-правило у `npm/policy/js_lint/lint_js_yml/` на відсутність `bunx knip` у `run:` кроці lint-js workflow.

- **ga (mdc v1.8 → v1.9) — заборона `depcheck` у workflow-файлах:** додано полісі `ga.workflow_common.deny` на будь-який виклик `depcheck` (через `npx`/`bunx`/`npm exec`/`pnpm exec` чи як standalone-команду) у `run:` кроку `.github/workflows/*.yml`. Перевірка невикористаних залежностей виконується разом з рештою лінтерів у `bun run lint-js` (`bunx knip`), окремий depcheck-крок у workflow зайвий. У `npm/mdc/ga.mdc` додано буліт «`depcheck`: не використовувати» з посиланням на `js-lint.mdc` і `ga.workflow_common`.

- **ci (тільки в цьому репо) — lint-ga встановлює conftest; knip.json налаштовано під монорепо:** `.github/workflows/lint-ga.yml` отримав крок `Install conftest` (curl-розпаковка релізу), бо `check-ga.mjs::runAllGaRego` ходить у `runConftestBatch` і hard-fail без бінарника. Кореневий `knip.json` розширено `workspaces.npm.entry` (всі CLI/scripts/tests як entry points — інакше knip false-positive репортить їх як unused), `ignoreBinaries` для `cspell`/`oxfmt`/`stylelint`/`vite` (всі через `bunx`/`npx`, не з deps), і `ignoreDependencies` для workspace self-refs. Це налаштування є кастомним для цього репо; інші проєкти налаштовують `knip.json` під свою структуру.

### Removed

- **js-run (mdc v1.6 → v1.7) — секцію «depcheck у GitHub Actions з path-фільтром» прибрано:** правило про обовʼязковий `npx depcheck --ignores="graphql,bun"` з `working-directory` у path-scoped workflow більше не діє — `depcheck` повністю мігровано на `knip` (див. js-lint.mdc), окремий крок у per-package workflow не потрібен. Файл `npm/scripts/utils/depcheck-workflow.mjs` видалено. У `npm/scripts/check-js-run.mjs` прибрано `checkDepcheckInWorkflows`, імпорти `findDepcheckViolationsForPackage` / `readAllWorkflowFiles` і параметр `workflows` у `checkWorkspacePackage`. У `npm/tests/check-js-run-fixture.test.mjs` видалено `describe('check-js-run: depcheck у path-scoped workflow', …)` (9 тест-кейсів) і допоміжну `writeRepoWithCronJobAndWorkflow`. У `.github/workflows/npm-publish.yml` прибрано крок `npx depcheck --ignores="graphql,bun,bun:test,@nitra/cursor"` з `working-directory: npm` — `lint-js` workflow покриває цю перевірку через `bunx knip`.

## [1.9.6] - 2026-05-12

### Changed

- **js-lint — ігнорувати `.claude/worktrees/` для jscpd і всіх лінтів:** правило `js-lint.mdc` (v1.18) тепер документує, що каталог `.claude/worktrees/` (робочі копії, які Claude Code створює через superpowers-skill `using-git-worktrees`) має бути виключений з лінт-перевірок. Канонічне місце — `.gitignore` (паралельні воркті — це за визначенням не-комітні робочі копії; `gitignore: true` у `.jscpd.json` уже є, тож запис у `.gitignore` каскадно вимикає сканування). Як страховку на випадок запуску jscpd без `gitignore: true` рекомендовано додати `.claude/worktrees/**` у `ignore` `.jscpd.json` — приклад у правилі оновлено. Без цього `bunx jscpd .` фіксує дзеркальні «клони» між кореневим репо і його worktree-копією у `.claude/worktrees/<name>/…`.

## [1.9.5] - 2026-05-12

### Changed

- **npm-module — компактний пакет: whitelist `files`, без `devDependencies`, тести/фікстури поза опублікованим деревом:** правило `npm-module.mdc` тепер вимагає максимально компактний tarball. (1) Поле `"files"` у `npm/package.json` обовʼязкове як whitelist (без нього npm пакує майже все). (2) `npm/package.json` не повинен містити `devDependencies` — інструментарій для розробки тримаємо у кореневому `package.json` монорепо, щоб `npm install @nitra/<pkg>` не тягнув його кінцевим користувачам. (3) Тести й фікстури не повинні потрапляти у tarball: канонічне місце — `npm/tests/` (не додається до `"files"`); це стосується і test-style каталогів (`tests/`, `__tests__/`, `fixtures/`, `__fixtures__/`, `spec/`, `test/`), і файлів за патернами `*.test.*` / `*.spec.*`, і JS/TS-файлів з імпортами test-фреймворків (`bun:test`, `node:test`, `vitest`, `@jest/globals`, `mocha`, `jest`, `ava`, …). **Виняток — Rego (`*_test.rego`):** за конвенцією conftest юніт-тест лежить поруч з полісі у тому самому `package`, тож rego-тести дозволені всередині опублікованого `policy/`-каталогу і входять у tarball.
- **npm-module — пер-документні deny у rego (Rego-authoritative):** `npm/policy/npm_module/npm_package_json/npm_package_json.rego` розширено двома deny: (а) `"files"` як whitelist обовʼязковий (відсутній / не масив / порожній); (б) `"devDependencies"` мають бути відсутні або порожні. Додано `npm_package_json_test.rego` з happy-path + 7 негативних кейсів (`json.patch` фікстури). Покривається `bun run lint-rego` (`conftest verify`) і `bun run lint-conftest` (батч проти реального `npm/package.json`). Раніше я помилково реалізував ці перевірки у JS — це порушує `.cursor/rules/conftest.mdc` (Rego-default для пер-документних структурних перевірок). Тепер виправлено: JS-функцію `checkPackageCompactness` видалено з `check-npm-module.mjs` разом з виклик-сайтом.
- **npm-module — `check-npm-module.mjs` лишає лише FS/AST-частину:** функція `checkNoTestsInPublishedFiles` резолвить позитивні patterns поля `files`, віднімає негативні (підтримка `!…` glob з `*` / `**` / `?`), і для кожного файлу-кандидата ловить test-style ім'я каталога/файлу або імпорт тест-фреймворку через oxc-parser (`module.staticImports` + `require()` + динамічний `import()`). `*_test.rego` свідомо не входить у `TEST_FILE_PATTERNS` — дозволений виняток для conftest-конвенції (юніт-тест поруч з полісі у тому самому `package`).
- **npm/package.json — приведено до правила:** видалено секцію `devDependencies` (`@nitra/cursor` вже є у корені як `workspace:*`). `policy/**/*_test.rego` свідомо лишаються у tarball — як виняток для conftest-конвенції.
- **conftest.mdc + npm/.claude-template/npm-CLAUDE.md — гостріший Rego-first сигнал:** у `.cursor/rules/conftest.mdc` додано STOP-блок перед `Edit` будь-якого `check-<rule>.mjs` (стосується і нових перевірок, і розширення вже існуючих; типовий ляп — `if (pkg.<field>) fail(…)` у JS замість ще одного `deny contains` у відповідному rego-пакеті). Перший пункт алгоритму уточнено прикладом «заборона/наявність ключа верхнього рівня типу `devDependencies` / `scripts.<name>`». У `npm-CLAUDE.md` секцію «Перш ніж писати `check-*.mjs`» переписано у self-check з 3 пунктів і червоним прапором. Регенеровано `npm/CLAUDE.md`.

## [1.9.4] - 2026-05-11

### Removed

- **graphql — вимога `scripts.dump-schema` у `package.json` прибрана:** правило `graphql.mdc` більше не вимагає канонічний скрипт `dump-schema` (раніше — `bunx graphqurl http://localhost:4040/v1/graphql -H 'X-Hasura-Admin-Secret: secret' --introspect > schema.graphql`) у корені проєкту за наявності gql tagged template literals. У `.mdc` відповідну буліт-точку та JSON-фрагмент видалено; фраза про «стандартний спосіб оновлення локальної `schema.graphql`» теж прибрана з підсумкового речення. Каталог `npm/policy/graphql/` (єдиний файл `package_json/package_json.rego` з deny-правилами на відсутність/неканонічний `scripts.dump-schema`) видалено повністю. Запис реєстру `graphql.package_json` (policyDir `graphql`, rule `graphql`, single `package.json`) прибрано з `npm/scripts/lint-conftest.mjs` (заголовок секції перейменовано — `graphql` вилучено). JSDoc-преамбулу `npm/scripts/check-graphql.mjs` оновлено: видалено абзац про rego-порт перевірки `dump-schema` і згадку `scripts.dump-schema` з JSDoc функції `check()`. Сам JS-чек і так не торкався `package.json` — після видалення rego-полісі ніяких runtime-перевірок `dump-schema` не лишається. У кореневому `package.json` репо cursor скрипт `dump-schema` теж видалено, оскільки тримати його як shim без правила немає сенсу.

## [1.9.3] - 2026-05-11

### Fixed

- **k8s — `pathHasK8sSegment` тепер відносно кореня репо; `.github/` явно поза скоупом:** функція `pathHasK8sSegment(filePath)` у `npm/scripts/check-k8s.mjs` та `npm/scripts/run-k8s.mjs` розбивала **абсолютний** шлях і шукала компонент `k8s`. У проєктах, де сам корінь репо називається `k8s/` (напр. `/Users/.../abie/k8s/`), сегмент `k8s` присутній в абсолютному шляху **усіх** файлів — і весь репозиторій, включно з `.github/workflows/*.yml`, потрапляв у `findK8sYamlFiles` як k8s-маніфести, після чого `checkK8sYamlFile` падав на «розширення .yml — перейменуй на .yaml» (територія `ga.mdc`, де канон протилежний). Виправлено: (1) сигнатура тепер `pathHasK8sSegment(filePath, root?)` — коли `root` передано, шлях спершу нормалізується через `node:path` `relative(root, filePath)`, і компоненти беруться **відносно кореня** (порожній relative — це сам root, повертає false); (2) `findK8sYamlFiles` у `check-k8s.mjs` і `check-abie.mjs`, а також `findK8sRoots` у `run-k8s.mjs` тепер передають `root` і додатково мають defense-in-depth ранній `return` для шляхів, що починаються з `.github/`; (3) `k8s.mdc` явно фіксує: правило стосується каталогів `k8s` відносно кореня; `.github/workflows/` і `.github/actions/` — поза скоупом (їх веде `ga.mdc`). Без `root` (юніт-тести з відносним шляхом) функція веде себе як раніше. Додано тести у `tests/check-k8s-schema.test.mjs` (worst-case з префіксом `/home/test/some/k8s/`) і `tests/run-k8s-roots.test.mjs` (інтеграційний — `findK8sRoots` у репі, корінь якого називається `k8s/`).

## [1.9.2] - 2026-05-11

### Changed

- **k8s — modeline `$schema` тепер опційний; `file:…` заборонено як плейсхолдер:** правило `k8s.mdc` уточнено — рядок `# yaml-language-server: $schema=…` обов'язковий **лише** коли для поєднання `apiVersion`/`kind` існує надійна публічна схема (kustomization / yannh / datree CRDs-catalog). Якщо публічної схеми немає, modeline **не додається зовсім** (раніше п. 5 розділу «Визначення схеми YAML» допускав `file:` за узгодженням — це створювало фальшиву видимість валідації, а автовиправлення n-fix залишало плейсхолдер `# yaml-language-server: $schema=file:.`). У `check-k8s.mjs`: (1) файли без modeline більше не падають як «перший рядок має бути коментарем», натомість `pass` із позначкою «без modeline — перевірка $schema пропущена»; (2) `$schema=file:…`тепер реєструється як помилка з підказкою прибрати modeline; (3) modeline нижче першого рядка все ще порушення; (4)`HttpBackendGroup`(Yandex ALB) як виняток без modeline залишається без змін.`lint-k8s`(kubeconform з прапорцем ignore-missing-schemas) продовжує покривати валідацію і для файлів без modeline. JSDoc на початку`check-k8s.mjs` оновлено.

## [1.9.1] - 2026-05-11

### Added

- **rego `k8s.base_kustomization` — defense-in-depth deny на HPA/PDB у `base/kustomization.yaml::resources:`:** додано пер-документне правило, що відмовляє, якщо `resources:` локально містить запис із basename `hpa.yaml`/`pdb.yaml`/`hpa.yml`/`pdb.yml` (у будь-якому підкаталозі). Канон k8s.mdc — HPA/PDB у sibling `components/` (Kustomize Component) і підключаються з overlay. Рекурсивний обхід дерева `resources:`/`components:`/`bases:` (із зануренням у вкладені kustomization.yaml) лишається у JS-оркестраторі `verifyK8sBaseKustomizeHasNoHpaPdb` (потребує fs-доступу). Rego-deny ловить найпоширеніший локальний випадок навіть якщо JS-крок упаде з винятку раніше. 5 нових rego-тестів (`hpa.yaml`/`pdb.yaml`/`hpa.yml` у `resources:`, чистий `resources:`, lookalike basename `myhpa.yaml`); `opa test` зелений (10/10).

### Fixed

- **`check-k8s.mjs`:** додано константу `GATEWAY_API_GROUP_PREFIX = 'gateway.networking.k8s.io/'`. Її відсутність кидала `ReferenceError` у `indexOneK8sYamlForHasuraCanon` (на лінії з `av.startsWith(GATEWAY_API_GROUP_PREFIX)`), яку ловив outer try/catch у `bin/n-cursor.js` і **тихо пропускав** усі наступні JS-валідатори в `check-k8s.mjs::check()` — серед них `validateKustomizeHpaPdbOnlyWithBaseDeployment`, `validateConfigMapNameMatchesDeployment`, `validateDeploymentHpaPdbAndTopology`, `validateProdKustomizationOverrides`. Наслідок у репах споживачів: правило «HPA/PDB заборонені у `k8s/base/`» не спрацьовувало (хоча `verifyK8sBaseKustomizeHasNoHpaPdb` логіку містив правильну), бо exception вилітав раніше за чергу JS-кроків. Rego-крок (`runAllK8sRego`) ішов **до** crash-точки й тому продовжував працювати — пер-документні перевірки залишалися активними, а cross-file JS — ні.

## [1.9.0] - 2026-05-11

### Changed

- **mdc frontmatter — `alwaysApply: false` + `globs` для файлово-чітких правил:** `ga` (`.github/workflows/*.yml`), `vue` (`**/*.vue`), `php` (`**/*.php`), `style-lint` (`**/*.{css,scss,vue}`), `nginx-default-tpl` (`**/default.{conf.template,tpl.conf}`), `image-avif` (`**/*.{png,jpg,jpeg,gif,avif,vue,html}`), `image-compress` (`**/*.{png,jpg,jpeg,gif,svg}`), `changelog` (`**/{CHANGELOG.md,package.json}`), `hasura` (`**/hasura/**,**/*.env`), `graphql` (`**/*.{vue,js,mjs,cjs,ts,tsx,jsx}`). Раніше тільки `docker`, `k8s`, `rego` тримали file-scoped формат; решта вантажилася в контекст Cursor завжди (`alwaysApply: true`). Тепер правило підтягується лише коли в контексті є файл за патерном — менше «шуму» у промптах для несуміжних задач. Версії bump-нуто на патч-крок у кожному `*.mdc`. Проєктно-широкі правила (`bun`, `npm-module`, `ci4`, `text`, `js-lint`) і opt-in (`abie`, `adr`) лишилися `alwaysApply: true` без globs.

## [1.8.229] - 2026-05-11

### Removed

- **k8s / `k8s.kustomize_managed`:** правило «`metadata.namespace` заборонено у YAML, досяжних через граф Kustomize» зняте — воно конфліктувало з `k8s.base_manifest`, який натомість **вимагає** `metadata.namespace` у `…/k8s/base/…` для namespaced kind. Перетин предикатів був порожній, що давало ~50 хибних помилок у канонічних деревах `base + overlays` (adminer, run/nginx, reference-grant, otel, dremio, gateway тощо). Видалено: правило з `mdc/k8s.mdc` (бульйт «Де не дублювати `metadata.namespace`»), rego-полісь `npm/policy/k8s/kustomize_managed/`, JS-helpers `metadataNamespaceForbiddenViolation` і `collectKustomizeManagedRelPaths` разом з відповідними тестами та плумінгом `kustomizeManagedRel` через `runAllK8sRego` / `checkK8sYamlFile`. Логіка `base_manifest` (`metadata.namespace` обов'язковий у `k8s/base/`) лишається; у overlays Kustomize це значення буде перезаписано полем `namespace:` з `kustomization.yaml`.

## [1.8.228] - 2026-05-10

### Changed

- **k8s / Plan B (rego-authoritative, повна централізація):** rego-крок переїхав на початок `check-k8s.mjs::check()` через новий helper `runAllK8sRego` — батч-виклик `runConftestBatch` для 9 пакетів (`k8s.manifest`, `k8s.gateway`, `k8s.hpa_pdb`, `k8s.kustomization`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`, `k8s.base_manifest`, `k8s.kustomize_managed`). JS у `check-k8s.mjs` робить лише cross-file orchestration + autofix + modeline. Cross-file orchestrators `validateHasuraConfigMapRemoteSchemaPermissions` і `validateHasuraHttpRouteCanon` рефакторнуто: JS відбирає paired-with-Hasura-Deployment файли, далі батч-conftest на `k8s.hasura_configmap`/`k8s.hasura_httproute`. Видалено JS-orchestrator-функції-дублі (≈10 шт): `scanForbiddenManifestsInYamlDocuments`, `failIfIngressInDocument`, `failIfAutoscalingV1InDocument`, `validateK8sYamlPolicyDocuments`, `failIfK8sPolicyNamespaceRulesViolated`, `failIfK8sPolicyResourceRulesViolated`, `runK8sYamlPolicyAndGatewayScans`, `scanGatewayApiRouteBackendRefsInYamlBody`, `failIfGatewayRouteUsesNonHeadlessService`, `validateKustomizationResourcesSortedAlphabetically`, `validateKustomizationPatchesStructuralSort`, `validateInlinePatchesSorted`, `validateKustomizationJson6902NoRemoveAddSamePath`, `auditJson6902OneKustomizationYamlFile`, `auditJson6902ForKustomizationYamlDoc`, `auditKustomizationPatchesJson6902`, `auditOneKustomizationJson6902Patch`, `auditJson6902PatchExternalFile`, `failIfJson6902RemoveAddConflictOnSamePath`, `verifyBaseKustomizationNamespaceOnFile`, `ensureBaseKustomizationHasNamespace`, `readFirstConfigMapDoc`. Видалено публічний predicate `isForbiddenAutoscalingV1Manifest` + його тест (rego `k8s.manifest` авторитативно). Решта predicates лишилися як публічні exports для back-compat (`hpaManifestViolations`, `pdbManifestViolations`, `deploymentTopologySpreadConstraintsViolation` все ще активно використовуються JS cross-file для expected-name/dev-like; інші — тестові shim, можна прибрати окремо).
- **`checkK8sYamlFile`** залишає тільки modeline + `$schema`-URL перевірки; per-document валідація (Ingress/autoscaling/v1 заборонено, Service GCP-анотації, Deployment resources/Hasura image/topologySpread, Gateway API backendRef правила, HCP, svc/svc-hl, namespace правила) — у rego, виконано на початку `check()`.

## [1.8.227] - 2026-05-10

### Changed

- **conftest.mdc (alwaysApply):** канонізовано патерн «Rego-authoritative + JS-orchestrator» (Plan B) як основний для всіх перевірок у репо. Розділ «Гібрид» переписано: замість «JS authoritative + rego-копія» (Plan A) — тепер чітко: пер-документне правило існує **рівно в одному місці** (rego), а `check-<rule>.mjs` делегує його через `runConftestBatch` (`npm/scripts/utils/run-conftest-batch.mjs`), один спавн на namespace. Додано конкретний шаблон `check()` (rego-крок перший, JS cross-file — після) і опис інтеграції з `lint-<rule>.mjs` (external-tools wrapper викликає `await checkX()` як останній крок). Реальні приклади — abie (пілот) і ga (повна централізація). Новий «червоний прапор» забороняє лишати JS-копію rego-правила «про всяк випадок» — це плодить дрифт.

## [1.8.226] - 2026-05-10

### Changed

- **ga / Plan B (rego-authoritative, повна централізація):** rego-крок переїхав із `lint-ga.mjs` у `check-ga.mjs::check()` як **перший крок**. Раніше `bun run lint-ga` сам викликав 4 per-workflow conftest + 1 batch для `ga.workflow_common`, а `npx @nitra/cursor check ga` цю частину не робив — тепер вся ga-логіка (rego + JS cross-file) в одному `check-ga.check()`. `lint-ga.mjs::runLintGaCli` спрощено: preflight (shellcheck/uv) → actionlint → zizmor → `await checkGa()`. Видалено: `CONFTEST_TARGETS`, `GA_POLICY_DIR`, `runConftestStep`, `runConftestWorkflowCommon` — і непотрібні імпорти `existsSync`/`readdirSync`/`dirname`/`join`/`fileURLToPath`. `runLintGaCli` тепер `async`; `bin/n-cursor.js` оновлено на `await runLintGaCli()`. Тест `lint-ga.test.mjs` оновлено: `await fn()` замість `fn()`. Тест `check-ga.test.mjs::"exit 1 коли shellcheck відсутній"` переведений на точковий виклик експортованої `checkShellcheckInstalled` (бо `withBinRemovedFromPath('shellcheck')` на macOS заодно видаляв `/opt/homebrew/bin` де conftest, ламаючи hard-fail у `runConftestBatch`).
- **`check-ga.mjs::checkShellcheckInstalled`:** додано `export` (потрібен для точкового тесту після рефактору).
- **тестова фікстура `setupCanonicalGaProject` у check-ga.test.mjs:** додано секцію `concurrency` (з канонічними `group` і `cancel-in-progress: true`) у workflow `clean-ga-workflows.yml`, `clean-merged-branch.yml`, `git-ai.yml` — `ga.workflow_common` rego тепер запускається у `check()`, а ці workflow раніше не мали concurrency у фікстурі (правило `lint-ga.yml` уже мало). Це **правильна** реакція: rego-перевірка тепер ловить порушення на тих самих фікстурах, на яких раніше не запускалась.

## [1.8.225] - 2026-05-10

### Added

- **utility `runConftestBatch`:** новий `npm/scripts/utils/run-conftest-batch.mjs` — спавнить `conftest test` одним викликом для batched-списку файлів, парсить `--output json`, повертає структуровані `{filename, namespace, message}` порушення. Hard-fail зі install-hint якщо `conftest` не у PATH (узгоджено з рішенням Plan B). Використовується з `check-*.mjs` для делегування пер-документної валідації у Rego-полісі без помітного сповільнення (один спавн на namespace, не на файл).

### Changed

- **abie / Plan B (rego-authoritative, pilot):** `npm/scripts/check-abie.mjs` рефакторнуто — пер-документна валідація 4 правил тепер делегується rego через `runConftestBatch`, JS залишає лише cross-file-оркестрацію (walking, path-фільтрацію, парність файлів). Видалені JS-функції-предикати (тепер єдине джерело істини — rego): `abieBaseHttpRouteHostnamesErrors`, `deploymentDocumentHasAbieBasePreemNodeSelector`, `parseCleanMergedIgnoreBranches`, `ignoreBranchesIncludesRequired`, `validateAbieHcPolicy`, плюс хелпери `collectAbieHostnames`, `isAllowedAbieBaseDevHostname`, `isAbiePreemTruthy`, `processBaseHttpRouteDoc`, `httpRouteHasNonEmptyHostnames`, `findHealthCheckPolicyInDocs` і константа `ABIE_REQUIRED_IGNORE_BRANCHES`. Імпорти `flattenWorkflowSteps`, `getStepUses`, `parseWorkflowYaml` (`./utils/gha-workflow.mjs`) теж прибрано — orphan після видалення JS-парсера workflow.
- **abie.health_check_policy (rego):** виправлено divergence з JS — тепер targetRef.name перевіряється точним match-ем `<hcp.metadata.name>-hl` (з нормалізацією: якщо name вже закінчується на `-hl`, береться як є). До цього rego перевіряло лише суфікс `-hl`, що дозволяло `targetRef.name=bar-hl` для HCP з `name=foo` — це не дзеркалило JS.
- **`validateAbieHcYaml` → `validateAbieHcModeline`:** export перейменовано — JS-частина перевірки hc.yaml тепер обмежується modeline (`# yaml-language-server: $schema=…`); парсинг YAML і структурна валідація HCP делеговано rego.
- **`npm/tests/check-abie.test.mjs`:** прибрано тести видалених JS-предикатів (8 тестів) — їх покриття тепер забезпечують `_test.rego` фікстури через `conftest verify`.
- **`npm/tests/cross-check-rego-abie.test.mjs`:** видалено — після Plan B JS-сторони для крос-чеку немає; `_test.rego` фікстури в кожному abie-пакеті дають аналогічне покриття.

## [1.8.224] - 2026-05-10

### Added

- **golden cross-check тести JS↔rego (abie):** додано `npm/tests/cross-check-rego-abie.test.mjs` (25 тестів), який для кожної пари (JS-предикат у `check-abie.mjs` ↔ rego-пакет у `npm/policy/abie/`) подає однаковий вхід у обидва імплементації через `opa eval --format json` і перевіряє інваріант **«обидва бачать порушення або обидва ні»**. Покриває: `deploymentDocumentHasAbieBasePreemNodeSelector` ↔ `abie.base_deployment_preem`; `parseCleanMergedIgnoreBranches`+`ignoreBranchesIncludesRequired` ↔ `abie.clean_merged_ignore_branches`; `abieBaseHttpRouteHostnamesErrors` ↔ `abie.http_route_base`; rego-only golden-фікстури для `abie.health_check_policy` (бо JS-функція `validateAbieHcPolicy` приватна). Тест автоматично пропускається, якщо `opa` не у PATH. Sanity-check ламанням rego навмисно — drift детектується.

## [1.8.223] - 2026-05-10

### Added

- **abie / нові rego-пакети:** `npm/policy/abie/base_deployment_preem/` (Deployment у `…/k8s/.../base/...` має `spec.template.spec.nodeSelector.preem` зі значенням, що вважається істинним — boolean `true` або рядок `"true"`); `npm/policy/abie/clean_merged_ignore_branches/` (у workflow `.github/workflows/clean-merged-branch.yml` крок `phpdocker-io/github-actions-delete-abandoned-branches` має `with.ignore_branches` з токенами `dev,ua,ru`, case-insensitive). Реєстрація в `lint-conftest.mjs` TARGETS: walk-pattern для base-resource YAML і single-target для workflow.
- **abie / `_test.rego` фікстури:** додано юніт-тести для всіх 4 abie-пакетів — нових (`base_deployment_preem_test.rego`, `clean_merged_ignore_branches_test.rego`) і існуючих (`http_route_base_test.rego`, `health_check_policy_test.rego`). 35 тестів покривають happy paths і deny-кейси.

### Changed

- **abie.health_check_policy (rego):** виправлено помилковий шлях `spec.config.httpHealthCheck` → правильний `spec.default.config.httpHealthCheck` (узгоджено з `validateAbieHcPolicy` у `check-abie.mjs`). Розширено перевірками: точна `apiVersion: networking.gke.io/v1`, `metadata.name` непорожній, `spec.default.config.type: HTTP`, `targetRef.kind: Service`. Cross-file звірка `<deployment.name>-hl` лишається у JS.
- **abie.mdc:** додано розділ «Швидкий gate через conftest (Rego)» зі списком rego-пакетів і опису того, що cross-file логіка (парність HCP↔Deployment, обчислений `<name>-hl`, валідація ru/ua-overlay JSON6902 patches, env→cluster DNS, cross-namespace backendRefs) лишається у `check-abie.mjs`.
- **lint-conftest.mjs TARGETS:** `abie.health_check_policy` і `abie.http_route_base` — `policyDir` уточнено до конкретного підкаталогу (`abie/health_check_policy`, `abie/http_route_base`) замість загального `abie`. Додано шляховий regex `K8S_BASE_RESOURCE_PATH_RE` для базових ресурсних YAML.

## [1.8.222] - 2026-05-10

### Added

- **k8s / rego-полісі:** розширено `npm/policy/k8s/manifest/manifest.rego` (Deployment cpu+memory у `requests`, Hasura image pin із білим списком тегів, канонічний `topologySpreadConstraints` з мітки `app` самого Deployment). Додано `manifest_test.rego` із вхідними фікстурами; rego тестується через `conftest verify` (опційний крок у `bun run lint-rego`). JS у `check-k8s.mjs` лишається authoritative — нові правила Rego — швидкий gate для одиничного маніфеста.
- **k8s / нові rego-пакети:** `npm/policy/k8s/gateway/` (Gateway API: backendRef з суфіксом `-hl`, redundant `namespace` у backendRef, HCP `targetRef.name` `-hl`); `npm/policy/k8s/kustomization/` (resources/patches алфавітне сортування, JSON6902 `remove`+`add` на той самий `path`); `npm/policy/k8s/svc_yaml/` (`Service.spec.type: ClusterIP`); `npm/policy/k8s/svc_hl_yaml/` (headless Service з суфіксом `-hl` і `clusterIP: None`); `npm/policy/k8s/base_kustomization/` (обов'язковий `namespace:`); `npm/policy/k8s/base_manifest/` (`metadata.namespace` у base, base-canon `cpu='0.02'`/`memory='128Mi'`); `npm/policy/k8s/kustomize_managed/` (заборона `metadata.namespace` у kustomize-managed файлах); `npm/policy/k8s/hasura_configmap/` (`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"`); `npm/policy/k8s/hasura_httproute/` (канон 4 правил Hasura: `/ql` Exact + `/ql/` Exact + PathPrefix + WebSocket); `npm/policy/k8s/hpa_pdb/` (структурний gate HPA/PDB: `apiVersion`, `behavior.scaleUp/Down`, `metrics`, `selector.matchLabels`). До кожного пакета додано `*_test.rego` фікстури.
- **lint-rego:** додано опційний крок `conftest verify` у `npm/scripts/lint-rego.mjs` після `regal lint` для виконання `*_test.rego`. Якщо `conftest` не у PATH — крок мовчки пропускається з install-hint.

### Changed

- **lint-conftest:** `npm/scripts/lint-conftest.mjs` — `k8s.manifest` target тепер указує на `policyDir: 'k8s/manifest'` (вужчий policy-tree), додано targets для нових пакетів `k8s.gateway`, `k8s.hpa_pdb`, `k8s.kustomization`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`, `k8s.base_manifest`. Шляхові регекспи: `K8S_KUSTOMIZATION_PATH_RE`, `K8S_BASE_KUSTOMIZATION_PATH_RE`, `K8S_BASE_MANIFEST_PATH_RE`, `K8S_SVC_YAML_PATH_RE`, `K8S_SVC_HL_YAML_PATH_RE`. Пакети `kustomize_managed`, `hasura_configmap`, `hasura_httproute` потребують cross-file gating з `check-k8s.mjs` і не входять у `lint-conftest` walk-targets.
- **n-k8s.mdc:** додано розділ «Швидкий gate через conftest (Rego)» зі списком rego-пакетів і опису того, що cross-file логіка (резолюція kustomize-tree, парність svc.yaml/svc-hl.yaml, прив'язка ConfigMap/HTTPRoute до Hasura-Deployment, HPA/PDB by directory, env-залежні межі min/maxReplicas) лишається у `check-k8s.mjs`.
- **conftest.mdc (alwaysApply):** замість одного абзацу про «пріоритет conftest» — повний алгоритм рішення для нової перевірки: декізія-дерево (single-document → Rego за замовчуванням; cross-file/FS/autofix/text-pre-YAML → JS), workflow «спершу намалюй вхід → rego або гібрид», список «червоних прапорів» (Rego не вміє X — звір зі списком винятків). Мета: робити Rego default-вибором для нових перевірок.
- **npm/.claude-template/npm-CLAUDE.md:** додано path-scoped нагадування «Перш ніж писати `check-*.mjs`» з посиланням на алгоритм у `conftest.mdc`. Регенеровано `npm/CLAUDE.md`.

## [1.8.221] - 2026-05-10

### Changed

- **ci4.mdc:** наповнено правило людинозрозумілим описом C4-моделі як джерела істини. Markdown-файли (C4 + ADR + тести + документація) — офіційне джерело істини про проєкт. Перед змінами агент аналізує відповідні C4-файли; кожна зміна, що впливає на модель, супроводжується оновленням C4-схеми у тому ж PR. ADR описує вплив рішення на C4 (які контейнери/компоненти з'являються/зникають/змінюють відповідальність). Кожен C4-компонент має посилання на відповідні тести. C4-схеми — частина користувацької документації, не закритий артефакт. Алгоритмічної `check-ci4.mjs` поки немає — правило процесне; `## Перевірка` залишено для майбутньої формалізації.

## [1.8.220] - 2026-05-09

### Fixed

- **k8s / `prodOverlayHpaPdbOverrideNeeds`:** виключено Kustomize Component (`kind: Component`) з prod-overlay-перевірки. Раніше `<pkg>/k8s/components/kustomization.yaml` помилково тригерив `прод-оверлей має перевизначати spec.minReplicas/maxReplicas/minAvailable` — але Component є **джерелом** ресурсів для overlays, не overlay сам по собі. Прод-перезаписи живуть у `ru/` / `ua/` / `prod/` тощо, що підключають Component через `components:`. Додано ранній return за `kind: Component` у `npm/scripts/check-k8s.mjs`; уточнення додано до `npm/mdc/k8s.mdc` і регресійний тест у `npm/tests/check-k8s-schema.test.mjs`.

## [1.8.219] - 2026-05-09

### Added

- **skill `n-llm-patch`:** наповнено `npm/skills/llm-patch/SKILL.md` (та дзеркальну копію `.cursor/skills/n-llm-patch/SKILL.md`). Скіл готує самодостатній текстовий промпт для іншого Claude/Cursor-агента у цільовому проєкті: read-only аналіз CWD (`package.json`, `tree -L 2`, `README`, релевантні конфіги), формування єдиного markdown-блоку за шаблоном `Завдання → Контекст → Релевантні файли → Що треба зробити → Обмеження → Як перевірити`. Цільова LLM — Claude / Cursor agent; жодних змін у поточному репо, тимчасові артефакти — лише у `/tmp`.

### Changed

- **k8s / check-k8s:** канонічна структура HPA/PDB — через **Kustomize Component** з фіксованою назвою каталогу `components/` (sibling до `base/`). У `base/` HPA і PDB не існує: ні локальних `hpa.yaml` / `pdb.yaml`, ні через `resources` / `components`. Overlays підключають `components: [- ../components]` і додають JSON6902-патчі для прод-значень `/spec/minReplicas`, `/spec/maxReplicas`, `/spec/minAvailable`. Для кожного `Deployment` у `…/k8s/…/base/` тепер вимагається sibling каталог `…/k8s/…/components/` з валідним `kustomization.yaml` (`kind: Component`), `hpa.yaml` (dev-like `min=max=1`) і `pdb.yaml` (dev-like `minAvailable=0`).
- **k8s / check-k8s:** заборона локальних `base/hpa.yaml` і `base/pdb.yaml` (file-existence для обох). Якщо в дереві base-kustomize лишилися HPA або PDB через `resources` / `components` — fail (`HPA/PDB заборонені у base — переведіть у components/`).
- **k8s / check-k8s:** прод-overlay тригерить вимоги патчів `/spec/minReplicas`, `/spec/maxReplicas` (HPA), `/spec/minAvailable` (PDB), коли overlay-tree містить HPA/PDB (тобто overlay підключив `components/`).
- **k8s.mdc:** оновлено опис, приклади `components/kustomization.yaml`, `components/hpa.yaml`, `components/pdb.yaml` і прикладу прод-overlay із `components: [- ../components]` + JSON6902-патчами.

### Removed

- **k8s / check-k8s:** прибрано застарілий механізм `$patch: delete` для HorizontalPodAutoscaler у `base/kustomization.yaml`. Видалено функції `verifyK8sBaseKustomizeHpaDeletedWhenInherited`, `kustomizationDeclaresHpaStrategicDelete`, `patchTextDeclaresHpaStrategicDelete` і константи-регекспи `HPA_STRATEGIC_DELETE_RE`, `HPA_KIND_LINE_RE` як мертві. Відповідні тести оновлено / видалено.

## [1.8.218] - 2026-05-09

### Added

- **auto-skills:** `llm-patch` додано як always-on скіл (без секції `[rules]` в `npm/bin/auto-skills.md`). Оновлено `AUTO_SKILL_ORDER` і `ALWAYS_ON_SKILLS` у `npm/scripts/auto-skills.mjs` та відповідні очікування у `npm/tests/auto-skills.test.mjs`. Сам вміст `npm/skills/llm-patch/SKILL.md` поки лишається стартовим — наповнюється окремо.

## [1.8.217] - 2026-05-09

### Added

- **js-run / conn-нейминг:** префікс `mssql-` тепер прийнятний у `src/conn/` нарівні з `mysql-` (`mssql-read.js`, `mssql-write-<id>.js` тощо). Сам npm-пакет `mssql` і раніше згадувався у правилі (як драйвер для MS SQL Server), але філенейм ставився під спільний `mysql-` префікс — це плутало читачів коду, де `import sql from 'mssql'` сусідив з файлом `mysql-write.js`. Тепер MSSQL має власний префікс із власним camelCase-експортом (`mssql-write-b2b` → `mssqlWriteB2b`). **Backward-compat:** проєкти, що вже використовують `mysql-…` для MSSQL-файлів, валідні без змін; рекомендований, але не обов'язковий рефактор — `git mv` цих файлів на `mssql-…` і відповідне перейменування іменованого експорту (`mysqlWrite` → `mssqlWrite`) зі оновленням імпортів через `#conn/*`.
- Регекс `CONN_FILENAME_RE` у `npm/scripts/utils/conn-file-rules.mjs` розширено до `(pg|mysql|mssql)-(read|write)(-<id>)?`; повідомлення про порушення в `npm/scripts/check-js-run.mjs` оновлено під чотири альтернативи; `mdc/js-run.mdc` має окремі пункти для MySQL і MSSQL.
- Тести: `npm/tests/conn-file-rules.test.mjs` (юніт-тести `isConnFileNameValid` / `kebabToCamel` / `findConnFileRuleViolations` під `mssql-`) та два інтеграційні кейси у `npm/tests/check-js-run-fixture.test.mjs` (`mssql-write.js` з валідним і невалідним експортом).

## [1.8.216] - 2026-05-09

### Changed

- **k8s / check-k8s:** орієнтир **`DEFAULT_CONTAINER_MEMORY_REQUEST`** поза base — **`512Mi`** (замість **`512`**).

## [1.8.215] - 2026-05-09

### Changed

- **k8s / check-k8s:** канон **`resources.requests.memory`** у шарі **`…/k8s/…/base/…`** — **`128Mi`** (замість **`128`**, щоб відповідати Quantity у Kubernetes); приймається **`Mi`** без урахування регістру.

## [1.8.214] - 2026-05-09

### Fixed

- **k8s / check-k8s:** конвертація image-replace patches → `images:` падала з `byPatch.keys(...).toSorted is not a function` (а в `rewriteInlinePatchWithoutOps` — з `(intermediate value).toSorted is not a function`), бо `Map.keys()` повертає ітератор, а `Set` — не масив, і `toSorted` на них немає. Тепер ключі/елементи матеріалізуються у масив через spread (`[...byPatch.keys()].toSorted(...)`, `[...new Set(opIndices)].toSorted(...)`).

### Changed

- **k8s / check-k8s:** у шарі **`…/k8s/…/base/…`** для **Deployment** жорстко **`resources.requests.cpu: '0.02'`** та **`memory: '128'`**; поза base обов’язкові **cpu** і **memory** (орієнтир **`0.5`** / **`512`** у підказках).
- **k8s / check-k8s:** заборона **`hpa.yaml`** у каталозі **`…/base/`**; якщо HPA є в дереві base — вимагається strategic-merge **`$patch: delete`** для **HorizontalPodAutoscaler** у **`base/kustomization.yaml`**.
- **k8s / check-k8s:** прод-оверлей вимагає patches на **HPA** (`minReplicas`/`maxReplicas`) лише якщо успадковане base **не** видаляє HPA через delete-patch; **PDB** **`minAvailable`** — якщо в base є PDB.
- **k8s.mdc:** оновлено правила та приклади під цю модель.

## [1.8.213] - 2026-05-09

### Added

- Нове правило `js-bun-redis` (`npm/mdc/js-bun-redis.mdc`): заміна `ioredis` /
  `node-redis` (включно з кореневим `redis` v4 і підпакетами `@redis/*`) на
  Bun native Redis (`import { redis } from 'bun'`,
  <https://bun.com/docs/runtime/redis>).
- AST-сканер `npm/scripts/utils/redis-imports.mjs` (`oxc-parser`) ловить
  `import` / `require` / динамічний `import()` пакетів `ioredis`, `node-redis`,
  `redis`, підшляхів `ioredis/...` / `redis/...` і `@redis/*`. Не зачіпає
  сторонні `redis-*` (наприклад, `redis-mock`).
- `npm/scripts/check-js-bun-redis.mjs` запускає AST-скан по JS/TS-джерелах і
  доступний як `npx @nitra/cursor check js-bun-redis`.
- Rego-полісі `npm/policy/js_bun_redis/package_json/` — заборона
  `ioredis` / `node-redis` / `redis` / `@redis/*` у `dependencies` будь-якого
  `package.json` у дереві; зареєстрована таргетом у
  `npm/scripts/lint-conftest.mjs` (`bun run lint-conftest`).
- Авто-увімкнення правила в `.n-cursor.json`: `npm/scripts/auto-rules.mjs`
  додає `js-bun-redis`, якщо в `dependencies` хоч одного `package.json` є
  `ioredis` або `node-redis` (умова — у `npm/bin/auto-rules.md`).
- Тести: `npm/tests/redis-imports.test.mjs` (AST-сканер) і нові кейси у
  `npm/tests/auto-rules.test.mjs` (детект `ioredis` / `node-redis`).

## [1.8.212] - 2026-05-08

### Changed

- `npm/skills/taze/SKILL.md`: повний workflow замість шаблону-заглушки. Тепер
  скіл бекапить `package.json`/`bun.lock`, виконує `bunx taze -w -r latest` +
  `bun install`, виявляє major-стрибки порівнянням з бекапом, тягне breaking
  changes з CHANGELOG модуля або git-діфу `node_modules` (з фолбеком на
  встановлення старої версії в `/tmp`), шукає використання зачепленого API в
  коді через `rg`, рефакторить несумісні місця (нетривіальні міграції — TODO),
  прибирає тимчасові файли і віддає структурований звіт користувачу.

## [1.8.211] - 2026-05-08

### Added

- Окремий шлях автодетекту для скілів — `npm/bin/auto-skills.md` +
  `npm/scripts/auto-skills.mjs` (`detectAutoSkills`). Скіли отримують свій
  словник умов (`skill - [rules]`), залежний від уже виявлених правил, тож не
  дублюють файлові ознаки з `auto-rules.md`.
- Нові авто-скіли: `publish-telegram` (завжди) і `taze` (за правилом `bun`).
- `npm/tests/auto-skills.test.mjs` — окремі тести `detectAutoSkills`
  (завжди-додавані, залежності від rule-id, `disable-skills`, фільтр за
  `availableSkills`).

### Changed

- `npm/scripts/auto-rules.mjs`: `detectAutoRulesAndSkills` → `detectAutoRules`
  (повертає лише `{ rules }`); прибрано `AUTO_SKILL_ORDER` і скіл-логіку.
  `mergeConfigWithAutoDetected` лишається спільним і приймає вже виявлені
  rules+skills, тож публічний контракт `.n-cursor.json` не змінився.
- `npm/bin/n-cursor.js` тепер послідовно викликає `detectAutoRules` і
  `detectAutoSkills` (скіли отримують `detectedRules` як вхід).
- `npm/bin/auto-rules.md` залишає тільки правила; секція скілів винесена в
  `auto-skills.md` з посиланням з `auto-rules.md`.

## [1.8.210] - 2026-05-08

### Added

- `js-bun-db` v1.6: правило тепер забороняє локальні pg-format-сумісні шими у
  файлах з Bun SQL.
  - Розділ `## pg-format: повне видалення, без шимів` у `npm/mdc/js-bun-db.mdc`:
    типові ідіоми `format(...)` → tagged template, заборонений drop-in `format()`
    і `pg`-сумісна `query(text, params)`-обгортка над `sql.unsafe(...)`.
  - Два нові AST-детектори у `npm/scripts/utils/bun-sql-scan.mjs`:
    `findPgFormatShimDefinitionInText` (функції `format` / `pgFormat` /
    `sqlFormat` / `pgFmt` з `%L`/`%I`/`%s` у тілі, плюс `quoteLiteral` /
    `quoteIdent` / `escapeLiteral` / `escapeIdent` без додаткової перевірки)
    та `findPgFormatLikeQueryWrapperInText` (`{ query(text, params) { ...
<obj>.unsafe(...) ... } }`). Скан запускається лише у файлах з
    `import { sql|SQL } from 'bun'`.
  - `npm/scripts/check-js-bun-db.mjs` рапортує `pgFormatShim` / `queryWrapper` —
    окремі лічильники й `pass`-рядки, без зміни існуючих перевірок.

## [1.8.209] - 2026-05-08

### Removed

- Дедуплікація JS-перевірок, що вже покриті Rego-полісі (запускаються через
  `bun run lint-conftest`):
  - `npm/scripts/check-bun.mjs` — без `checkBunfigHoisted`, `checkDevDependencies`,
    `checkLintAggregate`, перевірок `pkg.packageManager` і кореневого
    `pkg.dependencies`. Лишилася FS-existence (`bun.lock`, `bunfig.toml`,
    `package.json`, заборонені lockfile, директорія `.yarn/`) і cross-file гейт
    `lint-docker` / `lint-k8s` від `.n-cursor.json:rules`.
  - `npm/scripts/check-php.mjs` — без перевірок `lint-php` скрипта і `run` у
    `lint-php.yml`. Лишилися FS-existence для `composer.json`, `package.json`,
    `lint-php.yml`.
  - `npm/scripts/check-style-lint.mjs` — без перевірок `lint-style` через
    `npx stylelint`, `@nitra/stylelint-config` у `devDependencies`,
    `stylelint.extends`, `npx stylelint` у `lint-style.yml`. Лишилися VSCode-
    конфіги, `.stylelintignore`, FS-existence workflow і альтернатива зовнішнього
    конфіг-файлу `stylelint`.
  - `npm/scripts/check-graphql.mjs` — без `checkPackageDumpSchemaScript` (структура
    `scripts.dump-schema`); решта логіки (gql AST-скан, `.graphqlrc.yml`,
    VSCode-розширення) лишилася.
  - `npm/scripts/check-image-compress.mjs` — без `checkLintImageScript`,
    `checkLintAggregateIncludesImage`, `checkMinifyImageNotInDeps`. Лишилися
    `.n-minify-image.tsv` НЕ в `.gitignore` і видалення застарілого
    `.minify-image-cache.tsv`.
  - `npm/scripts/check-js-bun-db.mjs` — без `checkForbiddenDependencies`
    (`pg`/`pg-format`/`mysql2`); AST-скан коду (`new SQL(...)` всередині функції,
    `unsafe()` без маркера, динамічні `IN (…)`) лишився.
  - `npm/scripts/check-text.mjs` — без `checkOxfmtRc`, `checkCspellConfig`,
    `checkCspellJsonDictImports`, `checkMarkdownlintConfig`, `prettier`/`@nitra/cspell-dict`/`markdownlint-cli2`/`@nitra/*` гейт у
    `checkPackageJsonTextDepsUsage`. Лишилися VSCode-конфіги, `.v8rignore`,
    Prettier-файли в корені, абзац про український апостроф у `.mdc`,
    складна валідація скрипта `lint-text` і виклик `bun run lint-text` у
    workflow.
  - `npm/scripts/check-vue.mjs` — без `checkViteVersion` (vite ≥ 8). AST-скан коду
    і vite-config-перевірки лишилися.
  - `npm/scripts/check-npm-module.mjs` — без `checkNpmTypesField`,
    `emitTypesConfigIssues`, перевірок полів `npm-publish.yml`,
    `workspaces ∋ "npm"` у кореневому `package.json`. Лишилися FS-existence,
    наявність файлу зі шляху `types`, hk.pkl-перевірки, CHANGELOG-version-match,
    git-dirty-bump.
  - `npm/scripts/check-js-lint.mjs` — без `checkPackageJsonLintDeps`
    (prettier-залежність, `@nitra/eslint-config ≥ 3.9.2`),
    `checkPackageJsonTypeModule` для root, `checkEnginesNode/Bun` для root,
    канонічний `lint-js`-скрипт, валідація `lint-js.yml` (`verifyLintJsWorkflowStructure`
    - fallback). Лишилися — `.oxlintrc.json` canonical-snapshot, VSCode-розширення,
      workspace-ітерація для `type: "module"` і engines, дубль JS-кроків у `lint.yml`,
      `.jscpd.json`. Прибрано непотрібні імпорти `parseWorkflowYaml`,
      `verifyLintJsWorkflowStructure` і `OXLINT_FIX_RE`.
  - `npm/scripts/check-js-run.mjs` — без перевірок `bunyan` / `@nitra/bunyan` у
    залежностях, canonical `jsconfig.json` через `deepEqualJson`,
    `OTEL_RESOURCE_ATTRIBUTES` у `configmap.yaml`. Лишилися AST-скан коду
    (bunyan, conn-aliases, process.env, setTimeout) і FS-existence для
    `jsconfig.json` / `configmap.yaml`. Прибрано `CANONICAL_BACKEND_JSCONFIG`,
    `deepEqualJson`.
  - `npm/scripts/check-adr.mjs` — без `settingsHaveAdrHookGroup`,
    `checkProjectSettings` структурного порівняння і
    `checkLocalSettingsNoDuplicate`. Лишилися hash-порівняння bash-скрипта,
    `.gitignore`-патерн, LLM CLI у PATH, FS-existence settings.json.
    Прибрано `HOOK_COMMAND_MARKER`, `PROJECT_LOCAL_SETTINGS_PATH` (для
    settings.local — Rego policy gating).
  - `npm/scripts/check-ga.mjs` — без `verifyConcurrencyBlock`,
    `verifyNoDirectBunOrCache`, `verifyNoRunShellLineContinuationBackslash`,
    `verifyCheckoutBeforeLocalSetupBunDeps`, `validateConcurrencyOnRoot`. Тепер
    усі workflow-структурні перевірки виконуються через conftest у `lint-ga.mjs`
    (`ga.workflow_common`); лишилася лише git-залежна перевірка `on.*.paths`
    glob-ів через `git ls-files :(glob)`. Прибрано константи
    `SETUP_BUN_PATTERNS`, `FORBIDDEN_BUN_PATTERNS`, `EXPECTED_CONCURRENCY_GROUP`
    і непотрібні імпорти з `gha-workflow.mjs`.

### Changed

- Тести `check-bun.test.mjs`, `check-image-compress.test.mjs`,
  `check-js-bun-db.test.mjs`, `check-js-run-fixture.test.mjs`,
  `check-adr.test.mjs` — прибрано / `skip` тести, що дублювали Rego-полісі;
  лишилися лише FS / cross-file сценарії.
- `npm/policy/{capacitor,js_mssql,abie,k8s,hasura}/**/*.rego` — у заголовках
  policy-файлів додано позначку, що JS-чек у відповідному `check-*.mjs`
  лишається authoritative (повна semver-семантика з OR-діапазонами для
  `capacitor`/`js-mssql`; ширший набір полів і cross-file Kustomize-контекст
  для `abie`/`k8s`; cross-file env-DNS-резолюція для `hasura`). Rego там — швидкий
  гейт для одиничного файлу (наприклад через IDE).

## [1.8.208] - 2026-05-08

### Added

- `mdc/js-run.mdc` (1.6, з 1.5): новий розділ «Нейминг файлів у `src/conn/`» — префікси `ql-` (GraphQL endpoint), `pg-`/`mysql-` з обовʼязковим `read`/`write` режимом і опційним ідентифікатором підключення для multi-БД (`pg-read-smart.js`, `pg-write-contract.js`); якщо режим не очевидний з імені env — визначати за наявністю операцій зміни даних. Також правило про експорти в `src/conn/`: заборонено `export default`, лише іменований експорт у camelCase від назви файла (`ql-smart.js` → `export const qlSmart`, `pg-write-contract.js` → `export const pgWriteContract`).
- `scripts/utils/conn-file-rules.mjs` + інтеграція в `scripts/check-js-run.mjs` — для кожного файла всередині `#conn/` каталогу пакета перевіряє: (а) basename відповідає канону `ql-<id>` / `(pg|mysql)-(read|write)[-<id>]` (kebab-case `[a-z0-9-]`); (б) відсутній `export default`; (в) серед іменованих експортів є рівно `<camelCase(basename)>` (`pg-write-contract.js` → `pgWriteContract`). `index.*` пропускається як reexport-барель. Розпізнає `export const/let/var`, `export function`, `export class` і `export { x as Y }` через AST на oxc-parser.

## [1.8.207] - 2026-05-08

### Added

- `npm/policy/ga/workflow_common/workflow_common.rego` — універсальні Rego-перевірки для **кожного** `.github/workflows/*.yml`: блок `concurrency` (group / cancel-in-progress), заборонені `oven-sh/setup-bun` / `actions/cache` / `bun install` у `uses`/`run` будь-якого кроку, заборонене shell-продовження `\` перед NL у `run:`, обовʼязковий `actions/checkout@…` перед локальним composite-action `setup-bun-deps`. Підключено в `lint-ga.mjs` як один прогін `conftest test <…all yml…> --namespace ga.workflow_common`.
- `npm/policy/bun/{bunfig,package_json}/*.rego` — порт `check-bun.mjs` (TOML і JSON-частина): `[install].linker == "hoisted"` у `bunfig.toml`; у кореневому `package.json` без `packageManager`, без `dependencies`, у `devDependencies` лише `@nitra/*`; агрегований `lint`-скрипт покриває всі `lint-*` через `bun run` і завершується `&& oxfmt .`.
- `npm/policy/text/{oxfmtrc,cspell,markdownlint,package_json}/*.rego` — порт `check-text.mjs`: `.oxfmtrc.json` обовʼязкові ключі і канонічні значення; `.cspell.json` `version "0.2"`, `language`, імпорт `@nitra/cspell-dict`, заборона `@cspell/dict-*`, обовʼязкові `ignorePaths`; `.markdownlint-cli2.jsonc` `gitignore: true`; `package.json` без Prettier, `@nitra/cspell-dict ^2.0.0+`, без `markdownlint-cli2` у залежностях.
- `npm/policy/style_lint/{package_json,lint_style_yml}/*.rego` — порт `check-style-lint.mjs`: скрипт `lint-style` через `npx stylelint`, `@nitra/stylelint-config` у `devDependencies`, `stylelint.extends == "@nitra/stylelint-config"`; у `lint-style.yml` хоча б один `run` з `npx stylelint`.
- `npm/policy/php/{package_json,lint_php_yml}/*.rego` — порт `check-php.mjs`: скрипт `lint-php` у `package.json`; у `lint-php.yml` хоча б один `run` з `bun run lint-php`.
- `npm/policy/npm_module/{root_package_json,npm_package_json,emit_types_config,npm_publish_yml}/*.rego` — порт `check-npm-module.mjs`: `workspaces ∋ "npm"` у кореневому `package.json`; у `npm/package.json` `types` відповідає одному з канонічних патернів і `files ∋ "types"`; `npm/tsconfig.emit-types.json` має канонічні `compilerOptions`; `.github/workflows/npm-publish.yml` має `on.push.paths ∋ "npm/**"`, `branches ∋ "main"`, `permissions.id-token: write` і крок `JS-DevTools/npm-publish` з `with.package: npm/package.json`.
- `npm/policy/k8s/manifest/manifest.rego` — порт пер-документних структурних правил `check-k8s.mjs`: `kind: Ingress` заборонено (Gateway API), `apiVersion: autoscaling/v1` заборонено (HPA → v2), у `kind: Service` заборонені анотації `cloud.google.com/neg` / `cloud.google.com/backend-config`, у `kind: Deployment` кожен контейнер `containers`+`initContainers` має непорожнє `resources.requests.cpu`. Cross-file Kustomize-логіка (svc/svc-hl, HPA/PDB, namespace base, kustomization patches) лишається в JS.
- `npm/policy/js_lint/{package_json,lint_js_yml}/*.rego` — порт `check-js-lint.mjs`: канонічний `lint-js`, `@nitra/eslint-config ≥ 3.9.2`, `engines.node ≥ 24`, `engines.bun ≥ 1.3`, `type: "module"`; у `lint-js.yml` `actions/checkout@v6` з `persist-credentials: false`, `setup-bun-deps`, `bunx oxlint/eslint/jscpd .`, без `--fix` у CI.
- `npm/policy/js_mssql/package_json/package_json.rego` — порт `check-js-mssql.mjs`: `dependencies.mssql ≥ 12.5.0` (підтримує `^12.5.0`, `>=12.5.0`, `workspace:*`).
- `npm/policy/js_bun_db/package_json/package_json.rego` — порт `check-js-bun-db.mjs`: у `dependencies` заборонені `pg`, `pg-format`, `mysql2`.
- `npm/policy/js_run/{package_json,jsconfig,configmap}/*.rego` — порт `check-js-run.mjs`: заборона `bunyan` / `@nitra/bunyan` у залежностях; `jsconfig.json` має канонічні `compilerOptions` і `include`; у k8s ConfigMap `OTEL_RESOURCE_ATTRIBUTES` містить `service.name=` і `service.namespace=`.
- `npm/policy/vue/package_json/package_json.rego` — порт `check-vue.mjs`: якщо `dependencies.vue` присутній, у `devDependencies` має бути `vite` мажорної версії ≥ 8.
- `npm/policy/graphql/package_json/package_json.rego` — порт `check-graphql.mjs`: `scripts.dump-schema` точно відповідає канонічному.
- `npm/policy/image_compress/package_json/package_json.rego` — порт `check-image-compress.mjs`: `lint-image` викликає `npx @nitra/minify-image --src=. --write` без `--avif`; агрегований `lint` містить `bun run lint-image`; `@nitra/minify-image` НЕ у `dependencies`/`devDependencies`.
- `npm/policy/hasura/svc_hl/svc_hl.rego` — порт `check-hasura.mjs` (мінімум): у `hasura/k8s/base/svc-hl.yaml` Service з `metadata.name` має закінчуватись на `-h`.
- `npm/policy/adr/{settings_json,settings_local_json}/*.rego` — порт `check-adr.mjs`: `.claude/settings.json` має містити Stop-hook з командою `.claude/hooks/capture-decisions.sh`; `.claude/settings.local.json` (якщо існує) — НЕ повинен мати дубля цього хука.
- `npm/policy/capacitor/package_json/package_json.rego` — порт `check-capacitor.mjs`: `dependencies['@capacitor/core']` мажорна ≥ 8 (підтримує `workspace:*`).
- `npm/policy/abie/{health_check_policy,http_route_base}/*.rego` — порт `check-abie.mjs`: `HealthCheckPolicy` (`networking.gke.io/v1`) має непорожній `requestPath` зі слешем, `port: 8080`, `targetRef.name` закінчується на `-hl`; `HTTPRoute` у `…/base/…` приймає лише hostnames у домені `aiml.live`.
- `npm/scripts/lint-conftest.mjs` (+ `bun run lint-conftest` у `package.json`) — єдиний раннер conftest по всіх нових polysi: для кожного namespace — single-file або walk-предикат, з gating-ом по `.n-cursor.json:rules`, як у `check-*.mjs`. Викликається в кореневому `lint` після `lint-rego`.

### Changed

- `npm/policy/ga/{lint_ga,clean_ga_workflows,clean_merged_branch,git_ai}/*.rego`: прибрано дублікати правил `concurrency` (group / cancel-in-progress / missing) — їх покриває `ga.workflow_common`. Заодно усунено мовчазний баг `not is_object(input.concurrency)` (коли поля немає, повертає `undefined`, не `true`); у `workflow_common` через `object.get(input, "concurrency", false)` дає визначене значення. Канонічна тригер-група `expected_concurrency_group` теж видалена з кожної per-workflow polysi.
- `npm/scripts/lint-ga.mjs`: до існуючих per-workflow conftest-таргетів додано фінальний прогін `ga.workflow_common` одним викликом `conftest test <усі .yml> --namespace ga.workflow_common`. Імпорт `readdirSync` з `node:fs` для перерахунку workflow-файлів.

## [1.8.206] - 2026-05-08

### Added

- `mdc/rego.mdc` (нова версія 1.1, з 1.0): VS Code-секція з рекомендованим розширенням `tsandall.opa` (LSP від автора OPA: підсвічування, hover, go-to-definition, format-on-save через `opa fmt`), `.vscode/extensions.json` і `.vscode/settings.json` сніпети для `[rego]` (`editor.defaultFormatter: tsandall.opa`, `formatOnSave: true`); опис кроків `lint-rego` (preflight `opa`+`regal`, далі `opa check --strict` і `regal lint`); `package.json`-сніпет зі скриптом `lint-rego`; install-команди (`brew install opa regal` + universal лінки); приклад `.regal/config.yaml`. Раніше файл містив лише placeholder `npx @nitra/cursor check rego`.

### Changed

- `scripts/lint-rego.mjs`: додано preflight на `opa` (поряд з `regal`) з install-hint `brew install opa` і покликом до VS Code-розширення `tsandall.opa`; до `regal lint` додано попередній крок `opa check --strict <targets>` (типи + строгий режим: мертвий код, неоднозначні правила, незадекларовані змінні) — `opa check` ловить compile-помилки, які `regal` навмисно лишає поза скоупом. Якщо хоч один з `opa`/`regal` відсутній у `PATH` — exit 1 ще до запуску, з підказкою встановлення для обох.

## [1.8.205] - 2026-05-08

### Added

- `npm/policy/ga/lint_ga/lint_ga.rego` — порт `validateLintGaWorkflowStructure` + `validateLintGaOnTriggers`: `name` / `on.push.branches∋{dev,main}` / `on.pull_request.branches∋{dev,main}` / `on.push.paths∋{.github/actions/**,.github/workflows/**}` / `concurrency` / `jobs.lint-ga.runs-on` / `jobs.lint-ga.permissions.contents=read` / `steps` non-empty / `uses` set містить `actions/checkout@v6`, `./.github/actions/setup-bun-deps`, `astral-sh/setup-uv@v8.0.0` / `run` blob містить `bun run lint-ga`.
- `npm/policy/ga/git_ai/git_ai.rego` — порт `validateGitAiWorkflowStructure`: `name` / `on.pull_request.types∋closed` / `concurrency` / `jobs.git-ai.if` містить `merged == true` / `permissions.contents=write` / `run` blob містить `curl … usegitai.com … bash` і `git-ai ci github run`.

### Changed

- `scripts/lint-ga.mjs`: `CONFTEST_TARGETS` тепер охоплює всі 4 канонічні GA-workflow — `clean-ga-workflows.yml`, `clean-merged-branch.yml`, `lint-ga.yml`, `git-ai.yml` — кожен зі своїм `--namespace ga.<name>`.
- `scripts/check-ga.mjs`: видалено `validateLintGaWorkflowStructure`, `validateLintGaOnTriggers`, `validateGitAiWorkflowStructure`, `validateGitAiParsedYaml`, `hasPullRequestClosedTrigger`, `hasJobMergedCondition`, `checkLintGaWorkflow`, `checkGitAiWorkflow`, `checkCanonicalWorkflowsMatchRule`, локальний `isExactString` і відповідні імпорти `anyRunStepIncludes`/`flattenWorkflowSteps`/`getStepRun`/`getStepUses`. Файл скоротився з 1074 → 570 рядків (≈47%) — структурні перевірки канонічних GA-workflow повністю мігрували в conftest. У JS лишилися: file-existence (zizmor.yml, .vscode/settings.json, setup-bun-deps), `package.json` script `lint-ga`, MegaLinter-зачистка, `verifyConcurrencyBlock` для всіх workflow без винятків (включно з не-канонічними), `verifyNoDirectBunOrCache`, `verifyCheckoutBeforeLocalSetupBunDeps`, paths-globs через `git ls-files`, preflight `shellcheck`.

## [1.8.204] - 2026-05-07

### Changed

- Реструктурував `npm/policy/ga/` під namespaced sub-packages, які проходять regal: `ga/clean_ga_workflows/clean_ga_workflows.rego` та новий `ga/clean_merged_branch/clean_merged_branch.rego` (порт `validateCleanMergedBranch` з check-ga.mjs — `name` / `cron 0 1 15 * *` / `workflow_dispatch` / `concurrency` / `jobs.cleanup_old_branches` / step0 `phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3` з token / age=90 / ignore_branches main,dev / `dry_run: false` (YAML 1.1) / step1 `Get output` + `DELETED_BRANCHES` env + echo).
- `scripts/lint-ga.mjs`: `CONFTEST_TARGETS` тепер містить `clean-ga-workflows.yml` і `clean-merged-branch.yml`, conftest викликаємо з `--namespace ga.<name>` для ізоляції правил між workflow.
- `scripts/check-ga.mjs`: видалено `validateCleanGaWorkflows*` і `validateCleanMergedBranch*` — їх повністю покриває conftest у `lint-ga`. `checkCanonicalWorkflowsMatchRule` тепер валідує лише `lint-ga.yml` і `git-ai.yml` (наступні кандидати на міграцію).

### Added

- `.regal/config.yaml` у корені — вимикає `idiomatic.no-defined-entrypoint` (для conftest-полісі `deny`-правила є де-факто entrypoint-ами, формальна анотація не несе семантики).

## [1.8.203] - 2026-05-07

### Changed

- `check-k8s.mjs` (автоконверт `image-replace` patches → `images:`): тепер працює і для `patches[i].patch` із **кількома** ops, а не лише з одинокою image-replace op. Сканує всі ops у патчі, конвертує **кожну** `op: replace` на `/spec/template/spec/containers/<N>/image` (target `kind: Deployment`) у запис `images:`; якщо всі ops патча конвертовано — `patches[i]` видаляється повністю; інакше inline `patch:` переписується через `parseDocument` без конвертованих ops зі збереженням block-literal scalar (`|-`) і вихідного порядку решти ops. Реалізовано через нові функції `tryParseJson6902Array` (≥ 1 op, замість `tryParseSingleJson6902Array`) і `rewriteInlinePatchWithoutOps`; `imageReplaceDeploymentPatchInfo` повертає `{ deployName, totalOps, ops: [{ containerIndex, newImage, opIndex }] }` (раніше — одиничний `{ deployName, containerIndex, newImage }` лише за `length === 1`); `applyConversionsToDoc` групує конвертації по індексу патча й вирізає ops або сам патч за потреби. Сортування решти ops після видалення лишається поза цією зміною — за нього відповідає окрема перевірка `kustomizationInlinePatchOpsSortedViolation`.
- `mdc/k8s.mdc` (v1.26 → v1.27): уточнено крок 1 авто-перевірки в розділі «Зміна image — через `images:`, не через `patches[]`» — тепер описує і випадок, коли в `patches[i].patch` лишаються не-image ops (їх зберігає, у вихідному порядку, без коментарів).
- `check-js-lint.mjs` + `mdc/js-lint.mdc` (v1.16 → v1.17): мінімум `@nitra/eslint-config` піднято з `^3.8.0` до `^3.9.2`. Обґрунтування: з 3.9.2 у `getConfig` вбудовано ignore для `**/adr/**`, тож ADR-документи не валідуються ESLint, і консьюмерам не треба додавати цей glob у `eslint.config.js` локально. `nitraEslintConfigMeetsMinVersion` тепер повертає `false` для діапазонів `^3.8.x`–`^3.9.1`; `workspace:*` лишається ok без змін. Pass/fail-повідомлення `checkPackageJsonLintDeps` оновлено під новий мінімум; `for...in`-бан з 3.8.0 згадується як накопичена відмінність. Тести `nitraEslintConfigMeetsMinVersion` розширено: `^3.9.2`/`^3.9.10`/`^3.10.0`/`^4.0.0` — ok; `^3.9.1`/`^3.8.0`/`^3.6.12`/`^3.4.3` — ні.
- `bin/n-cursor.js` (`reexecIfPackageVersionChanged` + `spawnSync`-виклик): `process.env.NITRA_CURSOR_REEXEC` і `...process.env` замінено на `env.NITRA_CURSOR_REEXEC` і `...env` з `node:process` (`import { cwd, env } from 'node:process'`). Підстава: правило `js-run.mdc` забороняє прямий `process.env.*` у Node-коді; `NITRA_CURSOR_REEXEC` — опційна змінна (виставляється лише при re-exec), тож імпорт `env` з `node:process` (а не з `@nitra/check-env`) — канонічна форма для опційних. Поведінка не змінена; раніше `npm/scripts/check-js-run.mjs` помилявся на `bin/n-cursor.js:1136` (правило `process-env`), тепер integration-test `check-* на реальному репозиторії` проходить.

### Added

- `tests/check-k8s-images.test.mjs`: нова форма `imageReplaceDeploymentPatchInfo` (`ops`/`totalOps`/`opIndex`); e2e-тести на multi-op patch (image + `add nodeSelector`), три не-image ops + image у hasura-стилі (`add containers/-` + `add volumes` + `replace nodeSelector`), multi-image patch (containers/0 + containers/1 → обидва конвертовано, патч видаляється), mixed patch з digest у одному з image-values (звичайний tag конвертовано, digest op лишається у патчі) і одиничний digest-image (повертає `errors`, патч на диску не змінюється).

## [1.8.202] - 2026-05-07

### Added

- `bin/n-cursor.js`: новий хелпер `reexecIfPackageVersionChanged(effectivePackageRoot)` і його виклик у `runSync` одразу після `upgradeNitraCursorToLatestAndBunInstall`. Якщо self-upgrade встановив у `node_modules/@nitra/cursor` версію, відмінну від тієї, з якої стартував поточний процес (типово — npx-кеш), CLI спавнить `process.execPath <newBin> <args…>` через `spawnSync` (`stdio: 'inherit'`), додає в env `NITRA_CURSOR_REEXEC=1` і завершується з exit-кодом дочірнього процесу. Обґрунтування: ES-модулі (`RULE_MIGRATIONS`, `detectAutoRulesAndSkills`, списки правил) уже завантажені у V8 і нова логіка з-під свіжо встановленого пакета без re-exec невидима для поточного запуску — `import()` не вирішує цього, бо процес виконується з `bin/` у npx-кеші, а не з `node_modules/`. Захист від нескінченного циклу — раннє повернення при `process.env.NITRA_CURSOR_REEXEC === '1'`; додатково нічого не робить, якщо `effectivePackageRoot === BUNDLED_PACKAGE_ROOT` (реального апгрейду не сталося), якщо `version` не вдалося прочитати з обох `package.json`, або якщо у новому корені відсутній `bin/n-cursor.js`. `runChecks` свідомо не патчиться — він не виконує self-upgrade, тож версія процесу і пакета там завжди узгоджені. Імпорт `spawnSync` із `node:child_process` — єдина нова зовнішня залежність.

## [1.8.201] - 2026-05-07

### Changed

- `check-hasura.mjs`: `INTERNAL_HASURA_URL_RE` тепер приймає **обидва** кластерні DNS-суфікси у `HASURA_GRAPHQL_ENDPOINT` — `<cluster>.internal` (GKE/GCP, наприклад `abie-dev` / `abie-ua`) **і** `cluster.local` (стандартний k8s / Yandex Cloud). Раніше regex вимагав літеральний `.internal` у кінці, тож URL виду `http://apruv-h-hl.ru-apruv.svc.cluster.local:8080` (типовий для YC-кластера ru) помилково відхилявся. `parseInternalHasuraEndpoint` для YC повертає `cluster: 'cluster.local'` як повний суфікс, для GKE — ім'я кластера без `.internal` (зворотньо сумісно з попередньою поведінкою). Текст помилки в `checkEnvFile` оновлено — згадує обидва допустимі формати.
- `abie.mdc` (v1.17 → v1.19): нова секція «Внутрішньокластерні URL у env-файлах (dev / ua / ru)». Правило стосується **будь-якого** internal URL у env-файлах abie-проєкту — не лише `HASURA_GRAPHQL_ENDPOINT`, а й KVCMS, `auth-run-hl`, `file-link-hl` тощо. Таблиця `dev.env` / `ua.env` / `ru.env` → namespace-префікс + DNS-суфікс кластера (dev → `abie-dev.internal` + `dev-…`, ua → `abie-ua.internal` + `ua-…`, ru → `cluster.local` + `ru-…`); приклади з двома сервісами в одному файлі (Hasura + KVCMS). Загальне правило про **внутрішній** URL замість публічного домену для `HASURA_GRAPHQL_ENDPOINT` лишається у `hasura.mdc` (для nitra та abie).

### Added

- `check-abie.mjs`: новий валідатор `validateAbieEnvInternalUrls` (`String.prototype.matchAll` за `ABIE_INTERNAL_URL_GLOBAL_RE`) і helper `abieEnvNameFromBasename`. У функції `check()` додано крок `ensureAbieEnvFilesMatchClusterDns`, що сканує всі `*.env`-файли (basename `dev.env` / `ua.env` / `ru.env` опційно з провідною крапкою; `.env` без імені пропускається — як у `check-hasura.mjs`) і для **кожного** знайденого URL виду `http://<svc>.<ns>.svc.<dns>` перевіряє відповідність DNS-суфікса й namespace-префікса середовищу env-файла. Помилки додаються через `fail`, без зупинки на першому файлі — звіт показує всі порушення в усіх env-файлах одразу.
- `tests/check-hasura.test.mjs`: тести `parseInternalHasuraEndpoint` для GKE-style `abie-dev.internal` / `abie-ua.internal` та YC-style `cluster.local`; негативний кейс на сторонній суфікс (`svc.example.com`); інтеграційний тест `check()` для `hasura/.ru.env` з `cluster.local`.
- `tests/check-abie.test.mjs`: 7 unit-тестів на `abieEnvNameFromBasename` і `validateAbieEnvInternalUrls` (узгоджений dev/ua/ru, URL без порту, dev URL у ua-файлі, internal-суфікс у ru-файлі, ігнорування зовнішніх `https://` / `localhost`, кілька URL з різними порушеннями) і 4 інтеграційні (`.dev.env`+`.ua.env`+`.ru.env` узгоджені — 0; ua з dev URL у KVCMS — 1; ru з `.internal` замість `cluster.local` — 1; `.env` без імені пропускається).

## [1.8.200] - 2026-05-07

### Added

- `policy/ga/clean-ga-workflows.rego` + новий PoC-крок у `scripts/lint-ga.mjs`: запускає `conftest test` на `.github/workflows/clean-ga-workflows.yml` проти Rego-полісі (структура `name` / `on` / `concurrency` / `jobs.cleanup_old_workflows.steps[0]`). Якщо `conftest` не в PATH — `ℹ` skip без помилки (паралельні JS-перевірки в `check-ga.mjs` залишаються джерелом істини). Додав `policy` у `files` пакету.
- `check-k8s.mjs`: структурний сорт `patches[]` у `kustomization.yaml` за tuple `[target.kind, target.name, target.namespace, path]` (`localeCompare('en', base)`); поля `target.group` / `target.version` у tuple не входять (діє правило «patches[].target: лише kind і name»). Додатково: вміст inline `patches[i].patch` (literal block scalar — масив JSON6902) сортується за `path`, **але лише** коли всі ops — `add` / `replace` і всі `path` попарно дизʼюнктні (жоден не префікс іншого) — інакше порядок не чіпається, бо `move` / `copy` / `test` / `remove` чи спільні шляхи семантично залежні (RFC 6902). Експортовані чисті валідатори: `kustomizationPatchesSortedViolation`, `kustomizationInlinePatchOpsSortedViolation`.
- `tests/check-k8s-schema.test.mjs`: тести на обидва нові валідатори (приклад із `k8s.mdc`: `ReferenceGrant atlas/apruv` → `apruv/atlas`; `add /spec/minReplicas` + `replace /spec/maxReplicas` → пересорт за `path`; пропуск для `test` / `move` / `copy` / `remove` і недизʼюнктних шляхів типу `/spec` vs `/spec/template`).
- `mdc/k8s.mdc`: розділ «Структурний сорт `patches[]` і inline JSON6902» з обома прикладами «❌/✅».

## [1.8.199] - 2026-05-07

### Added

- `auto-rules.mjs`: автоматична міграція застарілих rule-id у `.n-cursor.json` через карту `RULE_MIGRATIONS`. Перший зареєстрований запис — `image` → `image-compress` + `image-avif` (split з 1.8.197). Застосовується і до `rules`, і до `disable-rules`, з дедуплікацією. CLI `n-cursor.js` логує `📦 Авто-міграція .n-cursor.json: image → image-compress, image-avif` перед нормалізацією, потім записує оновлений конфіг (як і раніше — лише якщо вміст реально змінився).
- `tests/auto-rules.test.mjs`: тести `migrateRuleIds` (порядок, дедуплікація, no-op для актуальних id), `detectLegacyRuleIds`, `mergeConfigWithAutoDetected` з legacy `image` у `rules`/`disable-rules`/конфлікті з `image-compress`.

### Changed

- `n-cursor.js`: розширено імпорт з `auto-rules.mjs` (`detectLegacyRuleIds`, `RULE_MIGRATIONS`); виокремлено хелпер `logRuleMigrationsIfAny` (читає сирий конфіг, виводить пояснення, не мутує — мутацію виконує `migrateRuleIds` усередині `mergeConfigWithAutoDetected`). Завдяки цьому `npx @nitra/cursor` сам перебиває `image` на пару наступників — користувачу не треба руками правити `.n-cursor.json`.

## [1.8.198] - 2026-05-07

### Changed

- `image-compress` (mdc v1.0 → v1.1): мінімум `@nitra/minify-image` піднято з **3.2.0** до **3.3.1**. У `3.3.1` upstream CLI порівнює sha1 raster-сорсу зі збереженим у `.n-minify-image.tsv` і автоматично перегенеровує `<source>.avif` при зміні контенту оригіналу — раніше stale `.avif` лишався поки розробник не видаляв його вручну. Додано пояснювальний абзац у правило.
- `image-avif` (mdc v1.0 → v1.1): крок 1 (`npx @nitra/minify-image --src=. --write --avif`) явно требує ≥ 3.3.1 і документує, що sha1-перевірка для регенерації застарілого AVIF тепер живе у CLI; `@nitra/cursor` цю логіку **не дублює**.

## [1.8.197] - 2026-05-07

### Changed

- `image` правило розщеплене на два самостійні: **`image-compress`** (валідація `lint-image` / `.gitignore` / залежностей — стиснення raster/SVG через `@nitra/minify-image`) і **`image-avif`** (генерація AVIF-двійників, переписування raster-посилань у `.vue`/`.html` на `.avif`, прибирання AVIF-сиріт). Це дозволяє тримати компресію всюди, а AVIF — лише там, де його підтримка гарантована (адмінки), вимикаючи його для публічних сайтів через `disable-rules: ["image-avif"]` у `.n-cursor.json` чи опт-аут на рівні пакета (`"@nitra/minify-image": { "disable-avif": true }` у `package.json` сайту).
- `auto-rules.md` / `auto-rules.mjs`: автодетект `image-compress - [bun]` (всюди, де є `package.json`), `image-avif - [vue, image-compress]` (лише для проєктів з `.vue`-файлами і вже активним `image-compress`).
- Видалено `npm/scripts/check-image.mjs` і `npm/mdc/image.mdc` — їх замінили `check-image-compress.mjs` + `check-image-avif.mjs` і `image-compress.mdc` + `image-avif.mdc`.
- Канонічний `lint-image` залишається без `--avif` (його перевіряє `image-compress`); `npx @nitra/cursor check image-avif` тепер є самостійною командою для AVIF-pipeline.

### Added

- `tests/auto-rules.test.mjs`: тест на `disable-rules: ["image-compress"]` → `image-avif` теж не додається (транзитивна залежність).

## [1.8.194] - 2026-05-07

### Fixed

- `check-image.mjs`: резолвер `resolveImagePath` був інлайн-наївний (`/path` → `<cwd>/<path>`, голий шлях → `null`), що в реальних Quasar/Vite-проєктах давало 0 rewrite-ів і помилковий ріст `failedRefs`. Замінено на `resolveImageCandidates`, який повертає **впорядкований список кандидатів**:
  - `./x.png` / `../x.png` → відносно файла-джерела;
  - `/x.png` → `<packageRoot>/public/x.png`, потім `<packageRoot>/x.png`, потім `<cwd>/x.png` (legacy fallback);
  - голий шлях з принаймні одним `/` (`assets/img.png`, `start-page-ua/logo.png`) → відносно файла-джерела + `<packageRoot>/public/<path>` (Quasar-конвенція);
  - bare без `/` → alias resolver невідомий, посилання тихо пропускаємо (без fail).
- `check-image.mjs`: `cleanupOrphanAvifs` тепер пропускає `.avif` у каталогах артефактів збірки (`build`, `android`, `ios`, `.output`, `.nuxt`, `.cache`) — раніше cleanup міг затирати продукт `bun run build` чи Capacitor sync.

### Added

- `tests/check-image.test.mjs`: 4 нових кейси — Quasar-style `src="/api-page/1.png"` через `<pkg>/public/`; `<img src="assets/images/x.png">` у `.html` через relative-to-source; `src="start-page-ua/logo.png"` у `.vue` через `<pkg>/public/`; cleanup не чіпає AVIF у `build/`/`android/`/`ios/`/`.output/`/`.nuxt/`/`.cache/`.

## [1.8.193] - 2026-05-07

### Fixed

- `check-image.mjs`: cleanup AVIF-сиріт більше не зачіпає `.avif` файли всередині пакетів з опт-аутом (`"@nitra/minify-image": { "disable-avif": true }`). Раніше: пакет з опт-аутом не сканувався на refs → його `.avif` потрапляли у список «сиріт» і видалялись, навіть якщо насправді використовувалися через alias / runtime-обчислений шлях. Тепер `checkVueAvifImports` повертає список абсолютних коренів opt-out пакетів, а `cleanupOrphanAvifs` пропускає `.avif` під ними.
- `check-image.mjs`: запис у `.vue`/`.html` тепер строго послідовний з cleanup (write-then-cleanup): перший виконує `checkVueAvifImports` (per-file `writeFile` після обробки), і тільки після цього `cleanupOrphanAvifs` читає вже оновлені `usedAvifAbs` і видаляє лише дійсних сиріт.
- `check-image.mjs`: введено агреговані лічильники `RewriteStats` (`rewrittenRefs` / `rewrittenFiles` / `failedRefs`) і єдиний фінальний рядок-підсумок `image: rewrote N references in M files; deleted K orphan AVIFs; failed to rewrite L references` — раніше підсумок дублювався per-package і не виокремлював orphan-cleanup vs failed-rewrites.

### Added

- `tests/check-image.test.mjs`: 5 нових кейсів — статичний `<img src="a.png">` авто-переписується (за наявності `a.png` і `a.png.avif`); реактивне `:src="dyn"` залишається незмінним і orphan AVIF видаляється; змішані форми у одному файлі (статичний + import + реактивний + `data-src=`) — переписуються лише покривані; opt-out пакет — AVIF всередині не вважається сиротою; ідемпотентність повторного `check image` на чистому стані.

## [1.8.192] - 2026-05-07

### Added

- `run-shellcheck-text.mjs`: для `lint-text` — перевірка наявності `shellcheck`/`patch`, авто-виправлення через `shellcheck -f diff` + `patch -p1`, фінальний прогін по tracked `*.sh` (git) або `**/*.sh` без `node_modules`.
- `text` (mdc v1.25 → v1.26): **shellcheck** у ланцюжку `lint-text`, рекомендація **`timonwong.shellcheck`**, тригер workflow **`**/\*.sh`**; тести `run-shellcheck-text.test.mjs`.

### Changed

- `check-text.mjs`: `lint-text` має містити `run-shellcheck-text.mjs`; `extensions.json` — `timonwong.shellcheck`.

## [1.8.191] - 2026-05-07

### Added

- `check-npm-module.mjs`: перший заголовок **`## [version]`** у `npm/CHANGELOG.md` має збігатися з **`version`** у `npm/package.json` (найсвіжіший реліз зверху — Keep a Changelog); якщо є незакомічені зміни під **`npm/`**, `version` у робочому `npm/package.json` має відрізнятися від **`HEAD`** (інакше ризик дописати новий функціонал без bump).

### Changed

- `npm-module` (mdc v1.9 → v1.10): розширено **«Build версія»** і **«CHANGELOG»** — чеклист для агента, заборона дописувати нові пункти в уже існуючу секцію релізу замість нового номера; впорядковано `CHANGELOG` (1.8.190 перед 1.8.189).

## [1.8.190] - 2026-05-07

### Added

- `js-run` (mdc v1.4 → v1.5): секція **`jsconfig.json`** — канонічний файл для backend-пакетів із каталогом **`src/`** (NodeNext, `include: ['src/**/*']`); для пакетів без `src/` вимога не діє.
- `check-js-run.mjs`: перевірка наявності та вмісту `jsconfig.json`, якщо в workspace-пакеті (без vite) є **`src/`**; тести у `check-js-run-fixture.test.mjs`.

## [1.8.189] - 2026-05-07

### Added

- Нове правило `adr` (вмикається **вручну** через `.n-cursor.json` `rules`): автоматичне копіювання канонічного `.claude/hooks/capture-decisions.sh` з пакета та керована Stop-група у `.claude/settings.json`, яка викликає скрипт асинхронно (`async: true`, timeout `180`s). Скрипт зчитує JSONL-транскрипт сесії, передає дайджест у LLM CLI і пише чернетки ADR/Runbook/Knowledge у `docs/adr/_inbox/`.
- `capture-decisions.sh`: fallback `claude` → `cursor-agent` (LLM CLI). Якщо `claude` відсутній, береться `cursor-agent -p --mode ask --output-format text`. Моделі задаються через ENV `CAPTURE_DECISIONS_CLAUDE_MODEL` (default `sonnet`) і `CAPTURE_DECISIONS_CURSOR_MODEL` (default `claude-4.6-sonnet-medium`).
- `check-adr.mjs`: програмна перевірка наявності та канонічності `.claude/hooks/capture-decisions.sh`, ADR-групи у `.claude/settings.json`, відсутності дубля у `.claude/settings.local.json`, ігнорування `.claude/hooks/capture-decisions.log` у `.gitignore`, інформативно — наявність бодай одного LLM CLI (`claude`/`cursor-agent`) у `PATH`.
- `tests/check-adr.test.mjs` (7 кейсів) і нові кейси у `tests/sync-claude-config.test.mjs`: copy + Stop-merge + ідемпотентність + автоматичне видалення managed-групи при видаленні `adr` з `rules`.

### Changed

- `sync-claude-config.mjs`: `MANAGED_HOOK_COMMAND_MARKERS` (масив) замість одиничного маркера; `mergeSettings(existing, template, { includeAdrHook })`; `syncClaudeConfig` приймає `rules` і умовно копіює ADR Stop-hook script + додає managed-групу до Stop. `syncClaudeConfig` повертає додатковий прапорець `adrHook`.
- `bin/n-cursor.js`: передає `rules` у `syncClaudeConfig` і логує `.claude/hooks/capture-decisions.sh` у підсумку Claude-конфіга.

## [1.8.188] - 2026-05-07

### Changed

- `vue` (mdc v1.6 → v1.7): для Volar/асетів канонічно лише **`jsconfig.json`** у корені пакета — прибрано альтернативу з `tsconfig.json`. `check-vue.mjs`: перевіряється лише наявність `jsconfig.json`.

## [1.8.187] - 2026-05-07

### Added

- `check-vue.mjs`: перевірка `src/vite-env.d.ts` з `/// <reference types="vite/client" />` та наявності `jsconfig.json` або `tsconfig.json` у корені кожного Vue-пакета (типи для імпортів асетів у `.vue`).

### Changed

- `vue` (mdc v1.5 → v1.6): секція **«Vite client types (Volar, імпорти асетів)»** — обов’язкові `vite-env.d.ts`, jsconfig/tsconfig; застереження щодо вузького `compilerOptions.types`. Оновлено блок **«Перевірка»**.

## [1.8.186] - 2026-05-07

### Added

- `check-js-run.mjs` + `scripts/utils/promise-settimeout-scan.mjs`: програмна перевірка нової секції js-run «Паузи через setTimeout». AST-сканер на `oxc-parser` ловить `new Promise(resolve => setTimeout(resolve, ms))` (з `await` чи без, arrow та function expression, concise та block body, тривіально загорнутий callback `() => resolve()`). Паттерни з передачею значення (`r => setTimeout(() => r(value), ms)`), іншим callback-ом замість resolve, або з додатковими стейтментами в блоці — поза правилом (це не «чиста» пауза).
- `tests/promise-settimeout-scan.test.mjs`: 13 модульних тестів (await/без, block-body, function expression, обгорнутий callback, false-positive guards, multiline номер рядка, кілька входжень, фільтр розширень).
- `tests/check-js-run-fixture.test.mjs`: 2 інтеграційні кейси на `check()` — fail при `await new Promise(r => setTimeout(r, ms))` у workspace-пакеті, pass при `await setTimeout(ms)` з `node:timers/promises`.

### Changed

- `js-run` (mdc v1.3 → v1.4): додано секцію **«Паузи через setTimeout»** — заборонено `await new Promise(resolve => setTimeout(resolve, ms))`, замість цього треба `await setTimeout(ms)` з `node:timers/promises`. Зауваження про затінення глобального `setTimeout` у тому ж файлі (за потреби callback-варіант імпортувати під іншим іменем, наприклад `setTimeoutCb` з `node:timers`).

## [1.8.185] - 2026-05-06

### Changed

- `image` (mdc v1.4 → v1.5): прапорець `--avif` у `lint-image` тепер **заборонений** (інакше `bun run lint` плодив би `.avif` для зображень, що ніде не вживаються); канонічний `lint-image` — `npx @nitra/minify-image --src=. --write`. AVIF-генерацію виконує **виключно** `npx @nitra/cursor check image`. Секцію «AVIF-імпорти у `.vue`» переписано: тепер вона документує триетапну логіку `check image` — (1) запуск `npx @nitra/minify-image --src=. --write --avif`, (2) авто-заміна raster-посилань у `.vue`/`.html` на `.avif` у кожному workspace-пакеті, (3) прибирання AVIF-сиріт (файли `.avif` без жодного посилання у `.vue`/`.html` видаляються — AVIF лишається лише там, де заміна реально вдалася).
- `check-image.mjs`: `checkLintImageScript` більше не вимагає `--avif`, натомість фейлить за його наявністю; додано `runAvifGeneration` (best-effort `npx ... --avif`, опт-аут через `NITRA_CURSOR_NO_AVIF_RUN=1` для тестів), `cleanupOrphanAvifs` (видаляє `<...>.avif` без живого посилання), `hasAnyRasterImage`, `resolveImagePath`. `checkVueAvifImportsInPackage` тепер не лише валідує, а й переписує raster-посилання на `.avif` (коли AVIF-двійник реально існує на диску); якщо `.avif` нема — фейл, як раніше. Сканування поширено на `.html` файли (раніше було тільки `.vue`).
- `tests/check-image.test.mjs`: `CANONICAL_LINT_IMAGE` без `--avif`; кейс «без `--avif`» перейменовано/перекинуто на «з забороненим `--avif`»; додано тести на orphan-cleanup (`.avif` без посилань видаляється) та авто-заміну raster-імпорту, коли `.avif`-сусід реально існує.

## [1.8.184] - 2026-05-06

### Added

- `check-js-run.mjs`: програмна перевірка нового правила «depcheck у GitHub Actions з path-фільтром». Для кожного backend workspace-пакета сканується `.github/workflows/*.yml`; якщо `on.push.paths` або `on.pull_request.paths` містить glob, що починається з `<rootDir>/`, у job очікується крок `npx depcheck` з `working-directory: <rootDir>` і `--ignores`, що містить мінімум `graphql,bun` (інші значення допустимі). Логіка — у новому `scripts/utils/depcheck-workflow.mjs` (парсинг `--ignores="…"` з підтримкою single/double-quote і unquoted формату; класифікація `missing` / `wrong-cwd` / `missing-ignores`).
- `check-js-run-fixture.test.mjs`: 9 нових кейсів — нема `.github/workflows/`, глобальні paths без скоупу пакета, scoped-paths без depcheck (fail), depcheck з неправильним `working-directory` (fail), без `--ignores` (fail), `--ignores` без `bun` (fail), валідний з extra-ignores (pass), вкладений `cron-jobs/foo/src/**` як scope (pass).
- `.github/workflows/npm-publish.yml`: додано власний крок `npx depcheck --ignores="graphql,bun,bun:test,@nitra/cursor"` з `working-directory: npm`, щоб репо `@nitra/cursor` саме відповідало новому правилу js-run (`paths: ['npm/**']` обмежено пакетом `npm`); extra-ignores потрібні для self-reference `@nitra/cursor` у devDependencies та для `bun:test` як bun-built-in.

## [1.8.183] - 2026-05-06

### Changed

- `ga` (mdc v1.6 → v1.7): додано **універсальну** вимогу — кожен workflow у `.github/workflows/*.yml` обов'язково містить блок `concurrency` з `group: ${{ github.ref }}-${{ github.workflow }}` і `cancel-in-progress: true`. Без винятків — scheduled cleanup-воркфлоу, `pull_request: types: [closed]`, publish-воркфлоу теж. Канонічні приклади у правилі (`clean-ga-workflows.yml`, `clean-merged-branch.yml`, `git-ai.yml`) оновлено й тепер містять цей блок.
- `check-ga.mjs`: нова перевірка `verifyConcurrencyBlock` — запускається на кожному `*.yml` у `.github/workflows/` і структурно перевіряє рівно два поля (`concurrency.group` дорівнює канонічному рядку, `concurrency.cancel-in-progress === true`); відсутність блоку, інший `group` або `cancel-in-progress: false` — fail. Спільний `validateConcurrencyOnRoot` додано в усі канонічні структурні валідатори (clean-ga-workflows, clean-merged-branch, lint-ga, git-ai), щоб ці workflow перевірялися й через шаблонну, і через універсальну логіку.

## [1.8.182] - 2026-05-06

### Changed

- `js-run` (mdc v1.2 → v1.3): додано секцію **«depcheck у GitHub Actions з path-фільтром»** — якщо в `.github/workflows/*.yml` тригер `paths:` обмежено каталогом одного backend-пакета (наприклад `cron-jobs/refund-loyalty-points/**`), у job має бути крок `npx depcheck --ignores="graphql,bun"` з `working-directory`, що вказує на той самий каталог. Список `--ignores` обов'язково містить мінімум `graphql,bun` (peer-залежність GraphQL та рантайм Bun, які depcheck не розпізнає коректно), але може бути розширений значеннями через кому без пробілів. Не застосовується до глобальних workflow без `paths:` або з кореневими `**/*.js` патернами.

## [1.8.181] - 2026-05-06

### Changed

- `scripts/utils/find-package-json-paths.mjs`: винесено спільну `findAllPackageJsonPaths(repoRoot, ignorePaths)` з `check-js-bun-db.mjs` і `check-js-mssql.mjs`, щоб усунути jscpd-дублювання. Самі check-скрипти тепер імпортують її, як інші утиліти з `utils/`.
- `scripts/utils/walkDir.mjs` / `scripts/utils/load-cursor-config.mjs`: trimming trailing-slash переписано з регулярки `/\\/+$/` на `while (s.endsWith('/'))`, щоб уникнути попередження `sonarjs/slow-regex` (потенційний backtracking) — поведінка не змінилась.
- `scripts/check-k8s.mjs`: `failIfExplicitPatchTargetsHaveRedundantGroupVersion` рефакторено — логіка одного запису винесена в новий хелпер `describePatchTargetRedundancy`, основна функція тепер просто будує повідомлення з результату (зменшено sonarjs/cognitive-complexity 24→<15, поведінка не змінилась).
- `scripts/claude-stop-hook.mjs`: `readStdin` і `runStopHookCli` переписані з `new Promise(resolve => …)` на `events.once(stream, 'end' | 'exit')` — підказка `eslint-plugin-promise/avoid-new`, поведінка не змінилась.

### Fixed

- `scripts/utils/bun-sql-scan.mjs`: у JSDoc `findBunSqlUnsafeUseWithoutAllowMarkerInText` прибрано вкладений приклад із backslash-backtick (`sql\\`...\\${value}...\\``), який ламав парсер коментарів oxlint і призводив до false-positive `eslint-plugin-jsdoc(require-param)`/`(require-returns)` на функції з валідним JSDoc — текст переписано без екранованих backtick-ів.
- Десятки `eslint-plugin-jsdoc` правил у `npm/scripts/**` та `npm/tests/**`: додано відсутні описи `@param` / `@returns` (включно зі спільним `ignorePaths`-аргументом у нових сигнатурах walkDir-обгорток), прибрано неприпустимі дефолтні значення в JSDoc (`[name=...]`) — без зміни поведінки.

## [1.8.180] - 2026-05-05

### Changed

- `js-run` (mdc v1.1 → v1.2): додано секцію **«Область застосування»** — правило явно не застосовується до frontend-пакетів (маркер `vite` у `devDependencies`). У браузерному бандлі немає `node:process`, тому заміна `process.env.X` на `import { env } from 'node:process'` ламає рантайм (`TypeError: Cannot read properties of undefined (reading 'X')`); для frontend замість `process.env.NODE_ENV` — `import.meta.env.MODE` / `import.meta.env.PROD`, інші ENV — лише `import.meta.env.VITE_*`. Передумова — інцидент у abie/b2b `site/`, де LLM-агент за правилом замінив `process.env.NODE_ENV` у `src/main.js` і вибив прод-бандл.
- `check-js-run.mjs`: workspace-пакети з `vite` у `devDependencies` пропускаються — нова `packageJsonHasViteDevDependency(pkgJson)`, виклик одразу після `loadPackageJsonAndCheckBunyanDeps`. bunyan-залежність у `package.json` все одно перевіряється (бо це робиться до раннього виходу), але скан `process.env`, `#conn/*` і OTEL configmap для frontend-пакета не запускається. Тести: 2 нові кейси у `check-js-run-fixture.test.mjs` (vite-пакет з прямим `process.env` — pass; non-vite пакет з тим же кодом — fail).

## [1.8.179] - 2026-05-05

### Changed

- `abie` (`check-abie.mjs` / `mdc/abie.mdc`): `httpHealthCheck.requestPath` у `HealthCheckPolicy` (`hc.yaml`) тепер допускає будь-який непорожній шлях від кореня — рядок, що починається з `/` (`/healthz`, `/IsAlive`, `/api/live` тощо), замість жорсткої вимоги `/healthz`. Решта вимог незмінна: `type: HTTP`, `port: 8080`, `targetRef` на headless Service з суфіксом `-hl`. Канонічно рекомендується `/healthz`, але правило не блокує сервіси з власним liveness endpoint. JSDoc у `check-abie.mjs` і опис у `mdc/abie.mdc` приведено у відповідність до коду. Тести: 3 нові кейси у `check-abie.test.mjs` (нестандартний `/IsAlive`, відсутній лідируючий `/`, порожній рядок).

## [1.8.178] - 2026-05-05

### Added

- `vue` (mdc v1.4 → v1.5): у `.vue` SFC заборонено імпортувати Node-нативні модулі — як з префіксом `node:` (`node:timers/promises`, `node:fs` тощо), так і bare-ім’я вбудованого модуля Node (`fs`, `path`, `crypto`, `fs/promises` …). Vue SFC виконується у браузері, де Node API недоступне; такі імпорти ламають білд / рантайм. Логіку з Node API треба виносити у server-side утіліту (backend-пакет монорепо), а у компонентах використовувати браузерні замінники (`window.crypto`, `URL`, глобальний `setTimeout`, `AbortController` тощо). Правило торкається лише `.vue` файлів — `.ts`/`.js`-утіліти, що споживаються server-side, можуть імпортувати Node-built-ins без обмежень.
- `check-vue.mjs`: нова гілка `checkVueNodeImportViolations` обходить `.vue` файли пакета (виключаючи `node_modules`/`dist`/…) і парсить `<script>` блоки тим самим **oxc-parser**’ом — для кожного `staticImport` перевіряє специфікатор через `isNodeBuiltinSpecifier(spec)` (префікс `node:` або bare-ім’я з `module.builtinModules`, з підтримкою підшляхів типу `fs/promises`). У повідомленні про fail виводиться `rel:line` і фрагмент import.
- `vue-forbidden-imports.mjs`: експортовано `isNodeBuiltinSpecifier`, `findForbiddenNodeImportsInText`, `findForbiddenNodeImportsInVueFile` (для не-`.vue` повертає `[]`). Тести: 5 нових кейсів у `vue-forbidden-imports.test.mjs` (built-in detection / `node:` префікс / bare-built-in / лише script-блоки SFC / non-`.vue` skip) та 2 нові integration-кейси у `check-rule-fixtures.test.mjs` (fail при `node:timers/promises` і при bare `fs` у SFC).

## [1.8.177] - 2026-05-05

### Changed

- `changelog` (mdc v2.0): тепер дві моделі бази порівняння на рівні воркспейсу. **npm-published** (`name` + `files` + не `private: true`) — порівняння з опублікованою версією через `npm view <name> version` (git не задіяний; покриває кейс прямих комітів у `main` поза PR-flow). **local-only** (приватні / без `files`) — PR-scoped через `git merge-base <dev> HEAD`, що коректно обробляє: feature-гілку (видно лише унікальні коміти), `main` після merge `dev → main` (diff порожній → правило мовчить), direct-commit на `main` поза PR (ловиться як зміна, що потребує bump). Якщо реєстр недосяжний (офлайн / пакет не публікувався) — fail-safe pass, щоб локальна розробка не блокувалась.
- `check-changelog.mjs`: повний рефактор. Експорт `check(opts?)` з опційним `getPublishedVersion` для підстановки в тестах (CLI калить без аргументів — використовується дефолтний `npm view`-виклик з 10s таймаутом). Класифікація воркспейсів через `isNpmPublishable(pkg)`; для published — `checkPublishedWorkspace`, для local-only — окрема `runLocalOnlyChecks` із власною skip-логікою (no-git / on dev / no dev ref / no merge-base) і `resolveMergeBase(baseRef)` через `git merge-base`. Спільна `verifyChangelogEntry` для обох режимів.
- `n-changelog.mdc` / `mdc/changelog.mdc` (v1.1 → 2.0): переписано під дві моделі з прикладами кейсів.
- Тести `check-changelog.test.mjs`: 16 кейсів (раніше 11) — npm-mode (sync / out-of-sync / no CHANGELOG / no entry / files без `CHANGELOG.md` / offline), local-only skip-логіка, merge-base сценарії (feature-гілка, `main` після merge `dev → main`, direct-commit на `main`), змішаний режим.

## [1.8.176] - 2026-05-05

### Changed

- `changelog` стало єдиним правилом про CHANGELOG для всіх воркспейсів — включно з `npm/`. У `check-npm-module.mjs` прибрано `checkChangelog()` (і константу `CHANGELOG_PATH`); відповідну секцію `## CHANGELOG` видалено з `mdc/npm-module.mdc` (v1.9). Логіка перевірки `npm/CHANGELOG.md` лишилася незмінна за наповненням, але тепер вона PR-scoped (порівняння з `dev`), тож на feature-гілці bump і запис достатньо зробити **один раз — як суму по PR**, без bump-шуму в проміжних комітах.
- `check-changelog.mjs`: додано перевірку `files`-масиву — якщо `<ws>/package.json` його оголошує, у ньому має бути `"CHANGELOG.md"` (приватні воркспейси без `files` цей пункт пропускають). Прибрано `SKIP_WORKSPACE = 'npm'` — `npm/` тепер у звичайному циклі. Хелпер `readPackageJsonOrNull` об'єднує читання `package.json` (раніше було два окремі читачі — `version` і `files`).
- `auto-rules.mjs` / `auto-rules.md`: `changelog` переведено на `AUTO_RULE_DEPENDENCIES = ['bun']` (раніше — пряма умова `packageJsonExists`); тепер послідовно з рештою правил.
- `npm/.claude-template/npm-CLAUDE.md` (і згенерований `npm/CLAUDE.md`): оновлено — посилається на `n-changelog.mdc`, явно згадує `files: ["CHANGELOG.md"]`, наголошує на PR-scoped логіці.
- Тести `check-changelog.test.mjs`: кейс `npm/ пропускається` замінено на `npm/ перевіряється з files=["CHANGELOG.md"]`; додано окремий кейс fail при `files` без `CHANGELOG.md`.

## [1.8.175] - 2026-05-05

### Added

- `k8s.mdc` / `check-k8s.mjs`: у маршрутах Gateway API (**HTTPRoute**, **GRPCRoute**, **TCPRoute**, **TLSRoute**, **UDPRoute**, група `gateway.networking.k8s.io`) забороняється поле `namespace` у `spec.rules[*].backendRefs[*]` (і однини `backendRef`), якщо його значення збігається з `metadata.namespace` самого маршруту. За замовчуванням Gateway API резолвить backend у тому ж namespace, що й маршрут — дублювання у `backendRef` мертве й заважає Kustomize-overlay, що міняє namespace маршруту. Cross-namespace backendRef (з відмінним `namespace`) правило не торкається. Експортовано `collectGatewayApiRouteBackendRefsWithRedundantNamespace(spec, routeNs)`; перевіряється усередині існуючого `failIfGatewayRouteUsesNonHeadlessService` (той самий обхід дерева, що й для headless-перевірки). Додано приклад «погано/добре» у `k8s.mdc` і відповідні юніт-тести.

## [1.8.174] - 2026-05-05

### Added

- Нове правило `changelog` (`mdc/changelog.mdc` + `scripts/check-changelog.mjs`): для «звичайних» Bun-монорепо проєктів вимагає, щоб у кожному workspace, який змінився відносно базової гілки `dev`, у поточному PR було підвищено `version` у `<ws>/package.json` і додано запис `## [version] - YYYY-MM-DD` у `<ws>/CHANGELOG.md` (Keep a Changelog 1.1.0). Перевірка PR-scoped: на самій гілці `dev` пропускається; на feature-гілці bump і запис достатньо зробити **один раз — як суму по всьому PR**, без бамп-шуму в проміжних комітах. Воркспейс `npm/` пропускається — його CHANGELOG покриває окреме правило `npm-module`. У `auto-rules.md` / `auto-rules.mjs` `changelog` додано до автодетекту з умовою «у корені є `package.json`» і до `AUTO_RULE_ORDER` між `capacitor` і `docker`.
- `.n-cursor.json` поле `ignore` (`schemas/n-cursor.json`): тепер не лише сигнал для AI, а й керує обходом усіх `check-*.mjs` / `run-*.mjs` — перелічені каталоги повністю виключаються з `walkDir`, як `node_modules` чи `.git`. Дозволяє безпечно тримати vendored Helm-чарти, генеровані маніфести, legacy-дерева у репо без false-positive’ів від check-скриптів. Розширено опис у схемі (стандартні виключення додавати не треба) і README отримав секцію «Виключення цілих дерев».
- `scripts/utils/load-cursor-config.mjs`: нова утиліта `loadCursorIgnorePaths(root)` — читає поле `ignore` з `.n-cursor.json` і нормалізує до абсолютних posix-шляхів без trailing-slash; пропускає не-рядки та порожні елементи; повертає `[]`, якщо файлу/поля нема або JSON невалідний.
- `scripts/utils/walkDir.mjs`: третій аргумент `ignorePaths` (за замовчуванням `[]`) — каталоги, які пропускаються разом з усім вмістом. Збіг — за повним шляхом (точний або з префіксом `/`), а не за basename, тож `postgres-master-test/` не пропускається коли в ignore лише `postgres-master/`. Стандартні пропуски (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`) працюють як раніше.

### Changed

- Усі скрипти, що обходять FS через `walkDir`, тепер на початку `check()` зчитують `loadCursorIgnorePaths(root)` і передають третім аргументом: `check-abie`, `check-docker`, `check-graphql`, `check-hasura`, `check-image`, `check-js-bun-db`, `check-js-mssql`, `check-js-run`, `check-k8s`, `check-nginx-default-tpl`, `check-npm-module`, `check-vue`, плюс `run-docker`, `run-k8s` і `rename-yaml-extensions`. Wrapper-функції (`findDockerfilePaths`, `findK8sYamlFiles`, `findLintDockerfilePaths`, `findK8sRoots`, `findDefaultConfTemplatePaths`, `migrateDefaultTplConfFiles`) отримали опційний параметр `ignorePaths` для прозорого пробросу.

## [1.8.172] - 2026-05-04

### Changed

- `auto-rules.md` / `auto-rules.mjs`: правило `php` тепер автоувімкається за наявністю `composer.json` у корені, а не за будь-яким `*.php` файлом у дереві. Прибрано константу `PHP_RE`, факт `hasPhpSource` і його збір у `updateFileFacts`/`collectAutoRuleFacts`; натомість у `detectAutoRulesAndSkills` додано прапорець `composerJsonExists` (за аналогією з `packageJsonExists` / `npmDirExists`).

## [1.8.171] - 2026-05-04

### Removed

- `abie.mdc` (v1.17) / `check-abie.mjs`: прибрано перевірку `.github/actionlint.yaml` (мітки `self-hosted-runner` `ua` / `dev` / `ru`). Видалено константи `ABIE_REQUIRED_ACTIONLINT_LABELS`, шаблон файлу та функції `parseActionlintSelfHostedLabels`, `abieMissingActionlintLabels`, `ensureAbieActionlintConfig`; знято відповідні юніт- та інтеграційні тести. Файл `.github/actionlint.yaml` більше не створюється і не валідовується правилом abie.

## [1.8.170] - 2026-05-03

### Changed

- `image.mdc` (v1.4) / `check-image.mjs`: правило перейшло на split-cache `@nitra/minify-image` ≥ **3.2.0**. Замість єдиного `.minify-image-cache.tsv` (який раніше мав бути або в `.gitignore`, або у `files`) тепер: (а) `.n-minify-image.tsv` у корені — committed source of truth з SHA-1/originalSize/size; правило вимагає, щоб він НЕ був у `.gitignore`; (б) `node_modules/.cache/@nitra/minify-image/mtime.tsv` — локальний fast-path, авто-gitignored через `node_modules/`, окремої перевірки не потребує. Додано міграційний fail: якщо `.minify-image-cache.tsv` лежить у корені або згадується в `.gitignore` — підказка з командою `git rm --cached` + `rm -f`. README + image.mdc-секція `## Split-cache` пояснюють, чому коміт hash-кешу осмислений (переживає `git clone`/`checkout`, на відміну від mtime).

## [1.8.169] - 2026-05-03

### Added

- `image.mdc` (v1.3) / `check-image.mjs`: нове правило `image` для оптимізації зображень через [`@nitra/minify-image`](https://www.npmjs.com/package/@nitra/minify-image). Перевіряє лише локальну конфігурацію (CI-workflow не вимагається — sharp/svgo тягнуть бінарні залежності, цінність на ubuntu-runner-ах нижча за час прогону): скрипт `lint-image` у `package.json` з обовʼязковим викликом `npx @nitra/minify-image --src=. --write --avif` (авто-оптимізація на місці + AVIF-двійники для PNG/JPEG/GIF), `bun run lint-image` в агрегованому `lint`, заборона `@nitra/minify-image` у `dependencies`/`devDependencies` (CLI лише через `npx`, симетрично до `markdownlint-cli2` у `text.mdc`) і рядок `.minify-image-cache.tsv` у `.gitignore` (або, рідше, у `files` пакета). AVIF-двійники (`<name>.<ext>.avif`) зберігаються в git як готові артефакти для віддачі браузеру.
- `image.mdc` (v1.3) / `check-image.mjs`: у `.vue` файлах кожного workspace-пакета raster-посилання мають вести на AVIF-двійник (`...png.avif`) у двох формах: (а) `import x from '...png|jpg|jpeg|gif'` (далі `:src="x"`); (б) прямі статичні атрибути `<img src="...png" />` у `<template>` (Vite перетворює їх на asset-імпорти при збірці). Реактивне `:src="..."` не сканується (JS-вираз — резолвиться через імпорт, який ловиться у формі (а)); `data-src=`, `obj.src=` у `<script>`, SVG-імпорти теж пропускаємо. Опт-аут на рівні воркспейс-пакета: `"@nitra/minify-image": { "disable-avif": true }` у `package.json` цього пакета. Дедуплікація обходу: при walk-у кореня `.` піддерева інших workspace-роди пропускаються (інакше `App.vue` у `demo/` доповідався б двічі).
- `auto-rules.mjs` / `auto-rules.md`: введено граф залежностей між правилами (`AUTO_RULE_DEPENDENCIES`, синтаксис у `auto-rules.md` — `rule - [other]`). Правило `image` описане як `image - [vue]` — варто автододати лише разом з `vue`, без дублювання вихідної умови «`.vue`-файли». Транзитивне розгортання дозволяє ланцюги (`a → b → c`) і поважає `disable-rules` (якщо vue вимкнено — image теж не додається).
- `vue.mdc` (v1.4) / `check-vue.mjs`: посилено перевірку `vite.config` — окрім згадки `AutoImport` тепер вимагається, щоб у виклику `AutoImport({ imports: [...] })` був присутній рядковий елемент `'vue'`. Без цього `unplugin-auto-import` не надасть `ref` / `createApp` / тощо, і прибирати явні value-імпорти з `'vue'` стає небезпечно (зламає код). Якщо `'vue'` у `imports` відсутній — value-імпорти більше не оголошуються забороненими, а fail зʼявляється на конфізі vite. Балансована екстракція аргументів `AutoImport(...)` через `extractAutoImportCallArgs` працює для багаторядкових об'єктів.

## [1.8.168] - 2026-05-03

### Added

- `lint-ga.mjs`: до preflight на `shellcheck` додано preflight на [`uv`](https://docs.astral.sh/uv/) (постачає `uvx` для `uvx zizmor`). Якщо `uv` відсутній у `PATH` — `n-cursor lint-ga` падає з exit 1 і підказками `brew install uv` / `curl -LsSf https://astral.sh/uv/install.sh | sh` / `pip install uv`. Обидва preflight’и повідомляються незалежно: якщо нема одночасно й `shellcheck`, і `uv`, користувач одразу бачить обидві підказки, а не лише першу.
- `lint-ga.mjs`: винесено внутрішній `PreflightDep` із `bin`/`winBins`/`explanation`/`install`/`successMsg` — однотипний pattern для додавання нових залежностей у preflight без копіпасти.

## [1.8.167] - 2026-05-03

### Added

- `lint-ga.mjs` / `bin/n-cursor.js`: нова CLI-підкоманда `n-cursor lint-ga` (експорт `runLintGaCli`). Робить preflight на `shellcheck` (exit 1 + brew/apt/pacman підказки, коли його немає в `PATH`), тоді послідовно запускає `bunx github-actionlint` і `uvx zizmor --offline --collect=workflows .` через `spawnSync` з `stdio: 'inherit'`. Тепер і `bun lint-ga` сигналізує про відсутність shellcheck — раніше це робила лише `check ga`.
- `ga.mdc` (v1.5): канонічний скрипт `lint-ga` у `package.json` тепер `n-cursor lint-ga` (а не `bunx github-actionlint && uvx zizmor …`); `check-ga.mjs` валідує саме цю форму. Виклик через bin-ім’я `n-cursor`, бо `bun run` транслює `npx` у `bun x`, а `bun x @nitra/cursor` для скоупованого пакету з одним bin-ім’ям повертає 0 без виконання.

## [1.8.166] - 2026-05-03

### Added

- `ga.mdc` (v1.4) / `check-ga.mjs`: нова перевірка локального [`shellcheck`](https://www.shellcheck.net/) у `PATH`. Без нього `actionlint` (`bunx github-actionlint`) мовчки пропускає shell-перевірки в `run:` блоках, тож локальний `bun lint-ga` дає зелений результат, який падає в CI на `ubuntu-latest` (де shellcheck передвстановлений). `npx @nitra/cursor check ga` тепер `fail` з підказкою встановлення (`brew install shellcheck` / `apt-get install -y shellcheck` / `pacman -S shellcheck`).

### Changed

- `utils/resolve-cmd.mjs`: явно передаємо `process.env` у `spawnSync('which'/'where', ...)`, щоб у Bun зміни `PATH` у runtime (наприклад, підстановка стабів у тестах) бачилися дочірнім процесом. Без цього Bun використовував би snapshot оточення на старті.

## [1.8.165] - 2026-05-01

### Changed

- `ga.mdc` / `check-ga.mjs`: лінт workflow-ів через [`github-actionlint`](https://www.npmjs.com/package/github-actionlint) замість `node-actionlint`. Канонічний скрипт `lint-ga` тепер `bunx github-actionlint && uvx zizmor --offline --collect=workflows .`; `check-ga` вимагає у `package.json` саме `github-actionlint`.

## [1.8.164] - 2026-05-01

### Added

- `abie.mdc` (v1.16) / `check-abie.mjs`: нова перевірка `.github/actionlint.yaml`. Якщо файл відсутній — `npx @nitra/cursor check abie` створює його з канонічним вмістом (`self-hosted-runner.labels: ['ua', 'dev', 'ru']`); якщо є — звіряє, що в `self-hosted-runner.labels` присутні мітки `ua`, `dev`, `ru` (порядок, інші мітки й формат лапок дозволені). Експортовано `ABIE_REQUIRED_ACTIONLINT_LABELS`, `parseActionlintSelfHostedLabels`, `abieMissingActionlintLabels`.

## [1.8.163] - 2026-05-01

### Changed

- `check-js-lint.mjs`: `ignorePatterns` у `.oxlintrc.json` тепер звіряється як `rules` — канонічні патерни мають бути присутні, додаткові локальні glob-и дозволені (раніше була строга рівність — будь-який зайвий запис зламував перевірку).
- `check-text.mjs`: `OXFMT_REQUIRED_IGNORE_PATTERNS` доповнено `**/auto-imports.d.ts` (узгоджено з каноном oxlint); перевірка `.oxfmtrc.json` уже працює як subset, тому локальні розширення не падають.
- `js-lint.mdc` / `n-js-lint.mdc`, `text.mdc` / `n-text.mdc`: документовано, що канон задає мінімум `ignorePatterns`, локальне розширення дозволене.

## [1.8.162] - 2026-05-01

### Changed

- `oxlint-canonical-skeleton.json` (та перебудований `oxlint-canonical.json`): `ignorePatterns` тепер містить `["**/schema.graphql", "**/auto-imports.d.ts"]` (узгоджено з `.oxfmtrc.json`). Споживачі мають синхронізувати корінь `.oxlintrc.json` із каноном — `check-js-lint` падатиме, поки масив не збігається.

## [1.8.161] - 2026-05-01

### Added

- `js-bun-db.mdc` (v1.5): нова секція «Прибирати pg-leftover виклики (`.connect()`, `.end()`)». У файлах з Bun SQL прапоруються `<obj>.connect(...)` і `<obj>.end(...)` як ручний lifecycle, який Bun SQL робить за тебе. Opt-out — маркер `// allow-pg-leftover: <причина>` (line- або block-коментар на тому ж рядку чи безпосередньо перед викликом).
- `bun-sql-scan.mjs`: новий сканер `findBunSqlPgLeftoverCallInText` (скоп — лише файли з `import { sql|SQL } from 'bun'`, щоб не давати false-positive на WebSocket/Stream `.end()`). Виділено спільний `hasMarkerCommentNear` для обох opt-in маркерів (`allow-unsafe`, `allow-pg-leftover`).

## [1.8.160] - 2026-05-01

### Changed

- `js-bun-db.mdc` (v1.4): `sql.unsafe(...)` тепер заборонено за замовчуванням — допустимо лише для підстановки назви таблиці/колонки чи dynamic SQL/DDL з code-controlled значенням; інакше переробляємо на tagged template `sql\`...${value}...\``. Кожен легітимний виклик має супроводжуватись маркером`// allow-unsafe: <причина>` на тому ж рядку або рядком вище.
- `check-js-bun-db.mjs`: замість вузької перевірки `sql.unsafe` із tagged-template і інтерполяцією тепер сканер `findBunSqlUnsafeUseWithoutAllowMarkerInText` падає на будь-якому `obj.unsafe(...)` без маркера-коментаря з непорожньою причиною (line- або block-коментар на тому ж рядку чи безпосередньо перед викликом).
- `ast-scan-utils.mjs`: додано `parseProgramAndCommentsOrNull` — окремий вхід для перевірок, яким потрібні коментарі поряд з AST.

## [1.8.159] - 2026-05-01

### Added

- Інтеграція з Claude Code: новий каталог `npm/.claude-template/` із `settings.template.json` (Stop hook + permissions allowlist), `npm-CLAUDE.md` (path-scoped нагадування для роботи в `npm/`) і slash-команду `/n-check`.
- `sync-claude-config.mjs`: під час `npx @nitra/cursor` синхронізує `.claude/settings.json` (merge — користувацькі поля зберігаються, наші hooks ідентифікуються маркером і перезаписуються), `npm/CLAUDE.md` і slash-команди checks.
- Subcommand `npx @nitra/cursor stop-hook` — точка входу Stop hook Claude Code (читає stdin, виходить 0 при `stop_hook_active=true` для захисту від рекурсії, інакше викликає `check`).
- Поле `claude-config` у `.n-cursor.json` (default `true`) для опт-ауту.
- Тести `npm/tests/sync-claude-config.test.mjs` — merge allow-list/hooks, інтеграція, ідемпотентність, опт-аут (12 кейсів).

### Changed

- `npm/schemas/n-cursor.json`: додано опис поля `claude-config`.
- `npm/package.json`: `.claude-template` додано в масив `files`, щоб публікувався з пакетом.

## [1.8.158] - 2026-05-01

### Changed

- `check-hasura.mjs`: файл `.env` без імені (локальний файл розробника) виключено з перевірки `HASURA_GRAPHQL_ENDPOINT` — скануються лише `*.env` із префіксом (`dev.env`, `production.env` тощо).
- `hasura.mdc`: явно зафіксовано виключення для `.env` без імені.

## [1.8.157] - 2026-04-30

### Added

- Правило `npm-module.mdc`: секція **CHANGELOG** — разом із bump build-версії в `npm/package.json` обовʼязково оновлювати `npm/CHANGELOG.md` (Keep a Changelog).
- `check-npm-module.mjs`: перевірка наявності `npm/CHANGELOG.md`, наявності в `files` у `npm/package.json` і запису для поточної версії.
- `check-hasura.mjs`: перевірка `HASURA_GRAPHQL_ENDPOINT` у `*.env` для проєктів **nitra** і **abie** — має бути внутрішнім кластерним URL виду `http://<service>.<namespace>.svc.<cluster>.internal:<port>`; за наявності `hasura/k8s/base/svc-hl.yaml` та `hasura/k8s/base/namespace.yaml` додатково звіряється `<service>` і `<namespace>`.

### Changed

- `npm/package.json`: `CHANGELOG.md` додано в масив `files`, щоб публікувався разом із пакетом.
- `hasura.mdc`: текст правила переформульовано як людинозрозумілий з прикладом і посиланням на `check-hasura.mjs`.
