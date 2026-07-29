# Універсальні plugin slots і винесення PHP у `@7n/rules-lang-php`

**Дата:** 2026-07-27
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** `docs/specs/2026-07-18-lang-plugins-extraction-spec.md`,
`npm/scripts/lib/resolve-plugins.mjs`, `npm/scripts/lib/plugin-api.mjs`,
`npm/scripts/lib/skill-fragments.mjs`

## 1. Проблема / Мета

PHP-specific поведінка зараз розподілена між кількома власниками:

- `npm/rules/php/**` містить правило, lint concerns і PHP tooling documentation у core-пакеті
  `@7n/rules`;
- `plugins/ci-github/rules/php/**` містить PHP-specific GitHub Actions workflow, validation і fix;
- `plugins/ci-azure/rules/php/**` містить PHP-specific Azure validation;
- `plugins/ci-github/rules/text/lint_text/**` і кореневий `.github/workflows/lint-text.yml`
  безумовно містять PHP glob;
- історичні docs/ADR, license identifiers, Docker image names і назви сторонніх actions також
  містять рядок `php`, але не є PHP language ownership.

Водночас plugin API має чотири різні механізми композиції:

- `contributes.rules: true` плюс конвенційний каталог `rules/`;
- `contributes.handlers` для `taze`, `coverage` і `doc-files`;
- `contributes.docFiles.extensions` для sync hot-path;
- конвенційний `skills/<skillId>/SKILL.fragment.md`, який не декларується у manifest.

Додавати окремий PHP→CI bridge поверх цих механізмів означало б створити п'ятий контракт.
Мета цієї зміни — одночасно:

1. винести весь актуальний PHP language ownership у новий пакет
   `@7n/rules-lang-php`;
2. замінити всі first-party plugin contribution surfaces одним versioned slot API;
3. дозволити language plugins постачати provider-specific CI artifacts без прямої залежності
   від `ci-*` plugins;
4. завершити перехід атомарно в репозиторії: у target state немає legacy manifest fields або
   legacy resolver paths;
5. зберегти поточну поведінку PHP lint і CI, не додаючи PHP taze, coverage або doc-files
   extraction, яких зараз немає.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Архітектура композиції | **Universal typed slot bus**. Усі contributions і consumers декларуються через `n-rules.slots`; core виконує discovery, envelope validation, version matching, ordering, provenance, caching і diagnostics |
| Б | Data чи code | **Declarative contribution + executable consumer adapter**. Contributor постачає immutable `value` або package-relative `resource`; лише consumer surface має право завантажити свій handler і матеріалізувати contribution |
| В | Міграція | **Повний перехід без постійного compatibility layer**. `contributes.rules`, `contributes.handlers`, `contributes.docFiles` і неявний skill-fragment discovery видаляються після міграції всіх first-party packages і call sites |
| Г | API scope | Slot broker універсальний. У цій зміні реалізуються canonical slots для `rules`, `skills`, `doc-files`, `taze`, `coverage` і `ci`; майбутній surface додає новий versioned slot, а не нове top-level поле manifest |
| Д | PHP ownership | `npm/rules/php/**` повністю переїжджає у `plugins/lang-php/rules/php/**`. PHP-specific GitHub/Azure templates і assertions переїжджають у `lang-php` як `ci.artifact@1` contributions |
| Е | CI ownership | `ci-github` і `ci-azure` більше не містять каталогів `rules/php/**`. Вони споживають `ci.artifact@1` generic adapters і знають лише формати/merge semantics свого provider |
| Є | Generic text workflow | PHP glob видаляється зі статичного `lint-text` template і додається contribution-ом `lang-php` як provider-specific patch. Так само видаляється безумовний PHP glob із кореневого generated workflow |
| Ж | Versioning | Slot version — positive integer, незалежний від package SemVer і `PLUGIN_API_VERSION`. Breaking envelope/broker change піднімає `PLUGIN_API_VERSION`; breaking payload change створює нову версію конкретного slot |
| З | Порядок | Contributions упорядковуються за resolved plugin order, потім за порядком у manifest. Поле `priority` у v1 заборонене; прихованого last-wins немає |
| И | Конфлікти | Broker ловить дубль `(pluginName, slot, version, id)`. Domain collision keys визначає consumer contract; semantic collision є error із provenance обох contributions, не silent override |
| І | Цикли | Runtime contributions не можуть створювати нові contributions. Broker будує один immutable graph; consumer handlers не запускаються під час discovery. Через це dependency cycles структурно неможливі |
| Ї | Відсутній consumer | Contribution без активного consumer ігнорується без warning. Це забезпечує zero-touch: `lang-php` не вимагає CI plugin |
| Й | Несумісність | Якщо активний consumer існує, але не підтримує жодної версії contribution, explicit CLI завершується non-zero з назвами slot/plugins/versions; hot-path пропускає contribution і повертає cached diagnostic |
| К | Scope PHP v1 | Немає нових `taze.provider`, `coverage.provider`, `doc-files.extractor` або `.php` doc-files extension. Їх можна додати пізніше окремими contributions без зміни broker |

## 3. Slot manifest contract

### 3.1. Форма manifest

Кожен plugin зберігає capabilities, але замінює `contributes` на `slots`:

```json
{
  "n-rules": {
    "requiresPluginApi": 2,
    "capabilities": ["lang:php"],
    "slots": {
      "provides": [
        {
          "slot": "rules.directory",
          "version": 1,
          "id": "php-rules",
          "resource": "./rules"
        },
        {
          "slot": "ci.artifact",
          "version": 1,
          "id": "php-github-lint",
          "resource": "./slots/ci/php-github-lint.json",
          "requires": {
            "capabilities": ["ci:github"]
          }
        }
      ],
      "consumes": []
    }
  }
}
```

Consumer declaration:

```json
{
  "n-rules": {
    "requiresPluginApi": 2,
    "capabilities": ["ci:github"],
    "slots": {
      "provides": [
        {
          "slot": "rules.directory",
          "version": 1,
          "id": "github-rules",
          "resource": "./rules"
        }
      ],
      "consumes": [
        {
          "slot": "ci.artifact",
          "versions": [1],
          "handler": "./slots/ci-artifact-consumer.mjs"
        }
      ]
    }
  }
}
```

### 3.2. Contribution envelope

Обов'язкові поля:

- `slot`: lowercase dot-separated identifier, regex
  `^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$`;
- `version`: positive integer;
- `id`: стабільний plugin-local identifier, regex `^[a-z][a-z0-9-]*$`;
- рівно одне з:
  - `resource`: шлях від package root, обов'язково починається з `./`;
  - `value`: JSON-compatible inline value.

Опційне поле:

- `requires.capabilities`: масив capabilities, усі з яких мають бути активні.

Заборонено:

- абсолютні paths;
- `..` segments і symlink escape за realpath;
- одночасні `resource` і `value`;
- executable function у manifest;
- `priority`, `before`, `after`;
- довільне виконання contribution під час discovery.

Broker додає runtime provenance, якої немає у manifest:

```js
{
  pluginName,
  packageRoot,
  slot,
  version,
  id,
  resourcePath,
  value,
  manifestIndex
}
```

### 3.3. Consumer envelope

Обов'язкові поля:

- `slot`;
- `versions`: непорожній масив унікальних positive integers;
- `handler`: безпечний package-relative module path.

Consumer handler:

- має default export object;
- декларує стабільний `id`;
- експортує `validate(contribution)` для slot payload;
- може експортувати surface-specific methods, визначені slot contract;
- не отримує mutable broker registry;
- не має права повертати нові slot contributions.

Core перевіряє лише universal envelope. Payload типізується й перевіряється consumer-ом.
Canonical first-party contracts та assertion helpers експортуються через
`@7n/rules/plugin-api`; third-party slot owner може постачати власну schema й types у своєму
package без зміни broker.

### 3.4. Resolution API

`npm/scripts/lib/resolve-plugins.mjs` лишається відповідальним за plugin discovery/install,
але повертає нормалізований slot manifest.

Новий модуль `npm/scripts/lib/plugin-slots.mjs` експортує:

```js
resolveSlotGraph(projectRoot, config, options)
getSlotContributions(graph, slot, supportedVersions)
getSlotConsumers(graph, slot)
loadSlotConsumer(consumer)
clearSlotResolveCache()
```

`resolveSlotGraph()` повертає:

```js
{
  plugins,
  capabilities,
  contributions,
  consumers,
  diagnostics
}
```

Вимоги:

- один filesystem/plugin scan на `(projectRoot, config, allowInstall)`;
- immutable result;
- deterministic ordering;
- diagnostics містять severity, code, plugin, slot, version і message;
- module import відбувається лише в `loadSlotConsumer()`;
- `allowInstall:false` ніколи не виконує network або package mutation.

## 4. Canonical slots target state

| Slot | Version | Contribution | Consumer |
|---|---:|---|---|
| `rules.directory` | 1 | directory resource | core rule discovery/lint/sync |
| `skills.fragment` | 1 | Markdown file + `value.skillId` | core skill sync |
| `doc-files.extensions` | 1 | inline map `extension → document type` | core sync hot-path |
| `doc-files.extractor` | 1 | module resource | core doc-files generation |
| `taze.provider` | 1 | module resource | core taze orchestrator |
| `coverage.provider` | 1 | module resource | core coverage orchestration |
| `ci.artifact` | 1 | JSON descriptor resource | active CI plugin consumer |

Нові surfaces не додають top-level fields у `n-rules`. Вони визначають новий slot contract,
version і consumer.

## 5. Повна міграція на slots

### 5.1. Core `@7n/rules`

1. Підняти `PLUGIN_API_VERSION` з `1` до `2`.
2. Додати envelope validators та path containment checks.
3. Додати slot graph, cache й diagnostics.
4. Перевести `resolveRulesDirs()` на `rules.directory@1`.
5. Замінити `getHandlers(..., 'taze')` на `taze.provider@1`.
6. Замінити `getHandlers(..., 'coverage')` на `coverage.provider@1`.
7. Замінити `getDocFilesExtensions()` на `doc-files.extensions@1`.
8. Замінити `getHandlers(..., 'doc-files')` на `doc-files.extractor@1`.
9. Замінити `collectSkillFragments()` convention scan на `skills.fragment@1`.
10. Видалити legacy normalizers і exports:
    - `manifest.contributes.rules`;
    - `manifest.contributes.handlers`;
    - `manifest.contributes.docFilesExtensions`;
    - `getHandlers()`;
    - `getDocFilesExtensions()`;
    - convention-only fragment lookup.
11. Додати machine-readable manifest schema та fixtures для валідного/невалідного graph.

Після міграції core не знає package names конкретних мов, крім таблиці автодетекту.

### 5.2. Наявні language plugins

`lang-js`, `lang-python`, `lang-rust` атомарно переписують manifests:

- `contributes.rules` → `rules.directory@1`;
- `handlers.taze` → `taze.provider@1`;
- `handlers.coverage` → `coverage.provider@1`;
- `handlers.doc-files` → `doc-files.extractor@1`;
- `docFiles.extensions` → `doc-files.extensions@1`;
- `skills/taze/SKILL.fragment.md` → explicit `skills.fragment@1`.

Файли provider/extractor/fragment можна не переміщати, якщо новий `resource` вказує на
чинний безпечний path. Поведінка provider modules і payload types не змінюється.

### 5.3. Наявні CI plugins

`ci-github` і `ci-azure`:

- декларують власний `rules.directory@1`;
- декларують consumer `ci.artifact@1`;
- додають generic consumer module;
- видаляють PHP-specific rule directories після parity tests;
- не імпортують `@7n/rules-lang-php`;
- не містять `php`, `composer`, `phpstan`, `psalm`, `phpcs`, `php-cs-fixer` або PHP setup
  literals у production code/templates.

## 6. Новий пакет `@7n/rules-lang-php`

Створити workspace `plugins/lang-php/` і додати його в:

- root `package.json#workspaces`;
- root `devDependencies` як `workspace:*`;
- monorepo test/config discovery, де language packages перелічені явно;
- lockfile стандартним `bun install`, без ручного редагування.

`plugins/lang-php/package.json`:

- name: `@7n/rules-lang-php`;
- public npm package;
- capability: `lang:php`;
- `requiresPluginApi: 2`;
- `rules.directory@1`;
- три `ci.artifact@1` contributions:
  - PHP lint workflow для GitHub;
  - PHP lint step/policy для Azure;
  - PHP path patch для GitHub `lint-text.yml`;
- peer dependency на сумісний major `@7n/rules`;
- без runtime dependency на `ci-github` або `ci-azure`;
- `files` включає `rules`, `slots`, `CHANGELOG.md`, виключає tests/fixtures.

Autodetection:

```js
php: {
  signal: 'composer.json',
  pkg: '@7n/rules-lang-php',
  maxDepth: 0
}
```

Root-only signal зберігає поточну семантику `npm/rules/php/main.json`. Підтримка nested
Composer workspaces не входить у extraction і потребує окремого рішення.

### 6.1. Перенесення PHP rule

Перемістити без behavioral rewrite:

```text
npm/rules/php/**
→
plugins/lang-php/rules/php/**
```

Зберегти:

- rule id `php`;
- auto glob `composer.json`;
- `cs_fixer` як per-file `**/*.php`;
- `phpcs` як per-file `**/*.php`;
- `project` як full-only;
- `tooling` як full;
- усі violation reason IDs і user-facing command names;
- `composer audit` як mandatory при активному PHP project;
- optional skip для відсутніх vendor tools;
- PHP 8.5 policy;
- відсутність source mutation у lint.

Оновити лише package-boundary imports:

- core helpers імпортувати через documented `@7n/rules/scripts/*` exports;
- не використовувати відносні paths назад у `npm/`;
- documentation paths змінити на `plugins/lang-php/rules/php/**`.

Окремо перевірити чинний інваріант `tooling`: PHP project також потребує root
`package.json`, бо plugin installation і `n-rules` lifecycle є npm/Bun-based. Ця спека його
не змінює.

## 7. `ci.artifact@1`

### 7.1. Payload

Descriptor:

```json
{
  "targetCapability": "ci:github",
  "artifactId": "lint-php",
  "targetPath": ".github/workflows/lint-php.yml",
  "format": "yaml",
  "mode": "required-file",
  "template": "./github/lint-php.yml.snippet.yml",
  "mergeStrategy": "deep-subset",
  "fix": true
}
```

Поля:

- `targetCapability`: capability consumer-а;
- `artifactId`: domain collision key;
- `targetPath`: consumer-repo relative path;
- `format`: у v1 лише `yaml`;
- `mode`:
  - `required-file` — файл обов'язковий;
  - `patch-existing` — contribution застосовується лише коли target artifact належить
    активному generic concern;
- `template`: path від descriptor directory, з containment validation;
- `mergeStrategy`:
  - `deep-subset` — objects рекурсивно; scalar arrays перевіряються/мерджаться як ordered
    set-union; arrays of objects використовують provider adapter identity;
  - `contains-step` — provider adapter шукає canonical step на будь-якій підтриманій
    вкладеності;
- `fix`: чи дозволений deterministic T0 fix.

Consumer відхиляє невідомі поля payload у v1. Нове поле, яке змінює semantics, потребує
`ci.artifact@2`.

### 7.2. GitHub consumer

`@7n/rules-ci-github`:

- підтримує `required-file` і `patch-existing`;
- для GitHub workflow object arrays ідентифікує:
  - jobs за key;
  - steps за `id`, потім `uses`, потім `name`;
- scalar path arrays мерджить set-union без видалення consumer-specific entries;
- `required-file` відсутній → violation і T0 creation;
- canonical mismatch → violation; fix виконує idempotent deep merge;
- diagnostics містять contributor plugin та `artifactId`.

PHP contributions переносять у `lang-php`:

1. повний чинний `lint-php.yml.snippet.yml`;
2. patch до `lint-text.yml`, який додає `**/*.php` у `push.paths` і
   `pull_request.paths`.

Зі статичного `ci-github` lint-text template і tests прибрати PHP literals; tests generic
consumer-а використовують нейтральні fixture identifiers.

### 7.3. Azure consumer

`@7n/rules-ci-azure`:

- підтримує `contains-step`;
- обходить `steps/jobs/stages` на будь-якій глибині;
- приймає canonical command або загальний `n-rules lint --no-fix --full`;
- перевіряє read-only marker `--no-fix`;
- у v1 зберігає чинну поведінку `fix: false`;
- diagnostics формуються з descriptor, без PHP literals у consumer.

PHP step/template та message data живуть у `lang-php`.

## 8. Класифікація всіх PHP-згадок

| Категорія | Дія |
|---|---|
| `npm/rules/php/**` | Перенести в `plugins/lang-php/rules/php/**` |
| `plugins/ci-github/rules/php/**` | Замінити generic consumer-ом; PHP payload/template перенести в `lang-php` |
| `plugins/ci-azure/rules/php/**` | Замінити generic consumer-ом; PHP payload/template перенести в `lang-php` |
| PHP glob у `lint-text` template/workflow | Винести в `lang-php` `patch-existing` contribution |
| Активні tests PHP rule/CI | Перенести PHP-specific fixtures до `lang-php`; generic consumer tests залишити у CI plugins |
| `KNOWN_LANG_PLUGINS` | Додати PHP autodetection |
| Root workspaces/devDependencies/lock | Додати `lang-php` |
| Поточні docs/index поруч із PHP code | Перенести разом із code і оновити links |
| Історичні `docs/specs/**`, `docs/adr/**`, CHANGELOG | Не переписувати; це historical record |
| `PHP-3.0`, `PHP-3.01` у Blue Oak data | Залишити: це SPDX/license identifiers |
| `php` як дозволений Docker base image | Залишити в Docker rule |
| `phpdocker-io/github-actions-delete-abandoned-branches` | Залишити в CI rule: це назва third-party action, не language logic |
| Приклади fenced code block `php` у documentation | Залишити там, де це syntax label або історичний приклад |
| Generated/cache/report files | Не редагувати вручну; regenerated artifacts перевірити окремо |

Після міграції production scan має підтвердити:

- у core немає PHP rule/toolchain logic;
- у CI plugins немає PHP-specific artifact payload;
- дозволені залишки відповідають таблиці вище.

## 9. Conflict, failure і security policy

1. Manifest parse failure — plugin diagnostic, explicit CLI non-zero.
2. `requiresPluginApi !== 2` — plugin не входить у graph; diagnostic містить required/actual.
3. Unsafe resource/handler path — hard error, resource не читається.
4. Missing resource — hard error із plugin/slot/id/path.
5. Unknown slot без consumer — silent no-op.
6. Consumer є, version intersection порожній — hard compatibility error.
7. Handler import failure — surface error, інші незалежні surfaces не запускають цей handler.
8. Invalid payload — hard error із JSON path або schema issue.
9. Duplicate contribution id усередині plugin/slot/version — hard error.
10. Domain collision між plugins — consumer error із provenance обох сторін.
11. Handler не може змінити graph, plugin order або capabilities.
12. Slot data і module paths кешуються лише на процес; filesystem state між CLI runs не
    припускається стабільним.

## 10. Послідовність реалізації

Усі кроки виконуються в одному feature branch; target state мерджиться без legacy API.

### Фаза 1 — contract і broker

1. Додати manifest schema, JSDoc types і fixtures.
2. Реалізувати slot envelope validation, safe path resolution і graph.
3. Додати tests ordering, capability filtering, missing consumer, version mismatch, duplicate
   ids, traversal/symlink escape, invalid handler і cache reset.
4. Підняти `PLUGIN_API_VERSION`.

### Фаза 2 — повна first-party migration

1. Перевести core consumers на canonical slots.
2. Переписати manifests `lang-js`, `lang-python`, `lang-rust`, `ci-github`, `ci-azure`.
3. Перевести explicit skill fragments.
4. Запустити parity tests taze, coverage, doc-files, rule discovery і skill sync.
5. Видалити legacy parsing/functions/tests.
6. Gate: production `rg` не знаходить legacy manifest fields та imports.

### Фаза 3 — generic CI consumer

1. Реалізувати `ci.artifact@1` contract.
2. Додати GitHub adapter і generic fixtures.
3. Додати Azure adapter і generic fixtures.
4. Перевірити двох contributors до одного target file, deterministic order і collision.

### Фаза 4 — PHP vertical slice

1. Створити `plugins/lang-php`.
2. Перенести PHP rule.
3. Перенести GitHub/Azure PHP artifacts у slot descriptors.
4. Перенести PHP path patch для `lint-text`.
5. Видалити старі PHP directories з core/CI plugins.
6. Додати autodetection, workspace wiring і lock update.

### Фаза 5 — repository і consumer parity

1. Regenerate root synced workflow/rules штатним `npx @7n/rules`.
2. Порівняти PHP lint violations до/після на fixtures:
   - без `composer.json`;
   - `composer.json`, але немає `composer`;
   - audit fail;
   - optional vendor tools absent;
   - PHPStan/Psalm/PHPCS/PHP-CS-Fixer fail;
   - delta `.php` files;
   - full/scoped run.
3. Порівняти GitHub `lint-php.yml` create/validate/fix.
4. Порівняти Azure lint-step validation.
5. Перевірити, що non-PHP repo не встановлює й не згадує `lang-php`.
6. Перевірити repo з `composer.json` + GitHub, з Azure і з обома providers.
7. Запустити full tests, delta lint, `bunx knip` і changelog gate.

## 11. Release і compatibility

Це breaking plugin API migration:

- core `@7n/rules` потребує major-compatible release line;
- first-party plugins декларують exact compatible core major через peer dependency;
- packages з major `>=1` отримують major bump; `0.x` packages — щонайменше minor bump;
- `lang-php` публікується як новий package;
- version fields і CHANGELOG вручну не редагуються — лише change files.

Release train:

1. опублікувати узгоджений набір під pre-release dist-tag;
2. виконати black-box install у чистих JS, PHP, Python і Rust fixtures;
3. перевірити auto-install та explicit `.n-rules.json.plugins`;
4. просувати весь набір у stable release як один coordinated operation;
5. у release notes дати одну команду coordinated upgrade для explicit plugin users.

У target stable line немає runtime legacy adapter. Старий core і старі plugins лишаються
сумісними у своїй попередній release line; змішування major lines завершується зрозумілою
plugin API compatibility error.

## 12. Tests і acceptance criteria

### Slot broker

- усі canonical slots резолвляться через один graph;
- порядок стабільний незалежно від filesystem enumeration;
- capabilities застосовуються до contributions до завантаження resource;
- path traversal і symlink escape заблоковані;
- no-consumer є silent no-op;
- version mismatch і collision мають actionable provenance;
- жоден consumer handler не імпортується під час discovery.

### Full migration

- у first-party manifests немає `contributes`;
- у production code немає `getHandlers`, `getDocFilesExtensions` або implicit
  `SKILL.fragment.md` scanning;
- `rules`, skills, doc-files, taze і coverage parity tests зелені;
- один plugin resolver/cache обслуговує всі surfaces.

### PHP

- `n-rules lint php` має той самий scope, commands, skip policy, reason IDs і output semantics;
- `composer.json` автоматично активує/встановлює `@7n/rules-lang-php`;
- без `composer.json` немає PHP plugin dependency або PHP diagnostics;
- GitHub/Azure artifacts еквівалентні попередньому канону;
- PHP glob у `lint-text` з'являється лише з активним `lang:php`;
- у core та CI plugins немає PHP-specific production payload.

### Definition of done

- `git diff --check`;
- marker scan;
- focused slot/PHP/CI tests;
- full `bun run test`;
- `bunx knip`;
- `npx @7n/rules lint`;
- `npx @7n/rules lint changelog`;
- окремі change files для кожного зміненого publishable workspace;
- black-box packed-package tests, а не лише workspace symlinks.

## Відкриті питання

Немає. Рішення про чистий API, повний first-party cutover, `ci.artifact@1`, conflict policy,
versioning, rollout і PHP ownership ухвалені цією специфікацією. Нові PHP capabilities
(`taze`, coverage, doc-files extraction) є окремими features, а не відкритими питаннями
цього extraction.
