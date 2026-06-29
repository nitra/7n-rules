# Spec: concern-рівневий lint-scope і уніфікація concern-моделі

**Дата:** 2026-06-28
**Статус:** Draft
**Тип:** Breaking — без зворотної сумісності, міграція одним кроком

**Пов'язані документи:**

- `docs/specs/2026-05-15-npm-rules-concern-and-target-design.md` — перший варіант concern-моделі (JS + policy/target.json); ця спека **замінює** схему `target.json` у фінальному стані
- `docs/specs/2026-05-31-rule-meta-json-design.md` — `main.json.auto` і поля rule-рівня; ця спека прибирає з `main.json` поля `lint` і `llmFix`
- `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md` — вісь поведінки fix/read-only; тут лише вісь scope

---

## Проблема

`main.json.lint` — скалярне поле (`"per-file"` | `"full"`), яке задає **один scope на ціле правило**. Але правило є доменною групою і може мати concerns із різними scopes:

- `js/eslint` — per-file (ESLint по змінених файлах)
- `js/knip` — full (мертві exports потребують цілого репо)

Зараз обидва concerns мусять вміститись в одну `main.mjs::lint()` з одним scope. Розв'язок — перенести scope на рівень concern.

Паралельна проблема: `policy/<name>/target.json` — окремий JSON-файл із targeting-метаданими поряд із `concern.json`-маркером якого ще не існує. Два JSON на один concern.

Третя проблема, яку треба врахувати під час міграції: у репо вже є **три різні поверхні concern-а**, а не тільки lint/policy:

- JS check-concern: `js/<concern>.mjs::main()` — conformance/fix-поверхня (`n-cursor fix/check`)
- policy-concern: `policy/<concern>/target.json` + Rego/template
- lint-concern: `main.mjs::lint()` — зараз rule-level, але фактично може містити кілька concerns

Якщо `concern.json` моделює лише `scope` або `files`, JS check-concerns стають без типу. Тому схема має описувати **surfaces**, а не один взаємовиключний kind.

---

## Рішення

### 1. Concern-каталог як одиниця

```
rules/js/
  main.json                  ← { "auto": {...} } — тільки rule activation
  main.mdc
  utils/                     ← helper modules (не concern — немає concern.json)
  eslint/
    concern.json             ← { "lint": { "scope": "per-file", ... } }
    main.mjs
  knip/
    concern.json             ← { "lint": { "scope": "full", ... } }
    main.mjs
  jscpd_config/
    concern.json             ← { "policy": { "files": { "single": ".jscpd.json", "required": true } } }
    jscpd_config.rego
    jscpd_config_test.rego
    template/
    jscpd_config.mdc
  jscpd_duplicates/
    concern.json             ← { "lint": { "scope": "full", "glob": ["**/*.{js,mjs,cjs,jsx,ts,tsx,vue}"] } }
    main.mjs
  lint_js_yml/
    concern.json             ← { "policy": { "files": {...}, "check": "template" } }
    lint_js_yml.rego
    lint_js_yml_test.rego
    template/
  dep_policy/
    concern.json             ← { "check": true }
    main.mjs
    dep_policy.mdc
  package_json/
    concern.json
    package_json.rego
    ...
  vscode_extensions/
    concern.json
    ...
```

Каталоги без `concern.json` (`utils/`, `lib/`, `docs/`, `coverage/`) — не concerns, оркестратор їх ігнорує. `js/` і `policy/` — forbidden після міграції, `npm-module` validation це перевіряє.

Concern id — ім'я каталогу з `concern.json` — завжди lower snake*case (`[a-z0-9*]+`). Це відповідає поточному policy inventory: на момент ревізії всі 50 унікальних `policy/<concern>`ids мають snake_case; id з`-`або іншими символами не виявлено. Rule id лишається kebab-case, як у`.n-cursor.json:rules`.

`jscpd_config/` і `jscpd_duplicates/` — два окремих concerns одного tool-домену: перший перевіряє конфіг-файл `.jscpd.json` через Rego (policy surface), другий запускає `bunx jscpd .` як lint-runner (lint surface, scope full). Multi-surface для них не застосовується — `main.mjs` і `.rego` відповідають різним виконавчим шляхам.

### 2. `concern.json` — схема

`concern.json` описує поверхні concern-а. Мінімум одна з поверхонь обов'язкова:

- `check` — JS conformance/fix concern (`main.mjs::main(cwd)`)
- `policy` — Rego або template concern (`<concern>.rego` або `policy.check:"template"`)
- `lint` — lint concern (`main.mjs::lint(changed, cwd, opts)`)

Одна директорія може мати кілька поверхонь, якщо це справді один домен. Наприклад `ga/workflows` може мати `check:true` для JS/Rego conformance і `lint` для `actionlint`/`zizmor`. Заборонено використовувати multi-surface як спосіб змішати непов'язані перевірки.

**Lint concern:**

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "lint": {
    "scope": "per-file",
    "glob": ["**/*.ts", "**/*.mjs"],
    "llmFix": true
  }
}
```

| поле          | обов'язковість | значення                                                                                                                |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `lint.scope`  | required       | `"per-file"` — детектор декомпозується на changed-set; `"full"` — крос-файловий                                         |
| `lint.glob`   | optional       | `per-file`: фільтр delta-файлів перед `lint()`; `full`: delta-тригер, concern запускається лише якщо glob ∩ changed ≠ ∅ |
| `lint.llmFix` | optional       | `true` — concern opt-in у opportunistic LLM-fix                                                                         |

Для `scope:"full"` без `lint.glob` concern **не запускається** у delta-режимі. Якщо потрібен whole-repo safety scan на кожну зміну (наприклад secrets), вказуй `glob:["**/*"]` явно.

**Policy concern:**

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "policy": {
    "files": { "single": ".jscpd.json", "required": true },
    "missingMessage": ".jscpd.json не існує — створи згідно js.mdc"
  }
}
```

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "policy": {
    "files": { "walkGlob": "**/package.json" },
    "check": "template"
  }
}
```

| поле                    | обов'язковість | значення                                                                                     |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `policy.files.single`   | один із двох   | шлях до конкретного файлу                                                                    |
| `policy.files.walkGlob` | один із двох   | glob або масив glob-ів для обходу дерева                                                     |
| `policy.files.required` | optional       | `true` — файл обов'язковий (default: `false`)                                                |
| `policy.check`          | optional       | `"template"` — generic template subset-check без власного `.rego`; відсутнє поле = Rego mode |
| `policy.missingMessage` | optional       | override повідомлення для відсутнього `required:single`                                      |

**JS check concern:**

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "check": true
}
```

`check:true` означає, що `main.mjs` експортує `main(cwd = process.cwd())` і виконується conformance-оркестратором (`n-cursor fix/check`). Якщо concern має тільки `lint`, `main()` не потрібен.

### 3. `main.json` після міграції

Видаляються поля `lint` і `llmFix` — вони переходять у `concern.json`. Залишаються rule-level поля:

```json
{ "auto": { "glob": ["**/*.mjs"] } }
```

`worktree` і `requireRoot` не додаються до rule `main.json` цією специфікацією: зараз це skill-level вісь у `skill-meta.json`.

### 4. `policy/` і `js/` обгортки

Фінально директорії `policy/` і `js/` зникають як discovery roots:

- `policy/<name>/target.json` → `<name>/concern.json#policy`
- `policy/<name>/<name>.rego` → `<name>/<name>.rego`
- `policy/<name>/template/` → `<name>/template/`
- `js/<name>.mjs` → `<name>/main.mjs` + `<name>/concern.json#check`
- `main.mjs::lint` rule-level → один або кілька `<name>/main.mjs::lint` + `<name>/concern.json#lint`

Helpers не стають concerns: вони живуть у `utils/` або `lib/`.

---

## Поведінка оркестратора

Discovery: сканувати `rules/<id>/` для підкаталогів із `concern.json`; читати surfaces (`check`, `policy`, `lint`) зі schema-validated JSON. Порядок виконання всередині правила — стабільний алфавітний за concern id, якщо інша залежність не буде додана окремою спеціфікацією.

### Check surface — `main.mjs::main(cwd)`

Conformance runner (`n-cursor fix/check`) виконує concerns із `check:true`.

Контракт:

```js
export async function main(cwd = process.cwd()) {
  return 0
}
```

Механізм `applies()`-гейту **видаляється без заміни**. Це свідома втрата runtime shape-gate поведінки: після міграції активне правило у `.n-cursor.json` означає "запускати його `check` concerns", без додаткового rule-level predicate. Поточні `js/applies.mjs` у `abie`/`python`/`rego`/`rust` видаляються; їхні перевірки на root markers або наявність файлів не переносяться в новий центральний gate.

### Policy surface — Rego/template

Поведінка незмінна відносно `target.json`: оркестратор резолвить `policy.files`, далі:

- `policy.check:"template"` → `runTemplateSubsetConcern`
- без `policy.check` → `runConftestBatch` із namespace `<rule_id_snake>.<concern>`

`missingMessage`, `files.required`, `files.single`, `files.walkGlob` мають зберегти поточну семантику.

Канонічний Rego package після міграції: `package <rule_id_snake>.<concern_id>`, де `rule_id_snake` — rule id із заміною `-` на `_`, а `concern_id` — snake_case назва concern-каталогу. Тести мають package `<rule_id_snake>.<concern_id>_test` і import `data.<rule_id_snake>.<concern_id>`. Compatibility shim для старих package names не додається.

Два правила мають legacy prefix-аномалію: `js` → `js_lint.*`, `style` → `style_lint.*` (суфікс `_lint` не є частиною rule id). Міграція виправляє й їх: `js_lint.*` → `js.*`, `style_lint.*` → `style.*`.

Для `jscpd_config` фінальний namespace:

- `rules/js/jscpd_config/jscpd_config.rego` → `package js.jscpd_config`
- `rules/js/jscpd_config/jscpd_config_test.rego` → `package js.jscpd_config_test`
- тести імпортують `data.js.jscpd_config`

### Lint surface — `main.mjs::lint(changed, cwd, opts)`

| scope      | mode                | `changed` у lint()                        | умова запуску                                                      |
| ---------- | ------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `per-file` | delta               | файли з delta, відфільтровані `lint.glob` | після фільтра є файли; якщо `glob` відсутній — передати весь delta |
| `per-file` | `--full`            | `undefined`                               | завжди                                                             |
| `full`     | `--full`            | `undefined`                               | завжди                                                             |
| `full`     | delta               | `undefined` (whole-repo)                  | `lint.glob` ∩ delta ≠ ∅                                            |
| `full`     | hook/explicit files | не запускається                           | hook-mode лишається per-file-only                                  |

`opts`: `{ readOnly, llmFix }` — як зараз.

`lint <rule>` запускає всі lint-surfaces цього rule у whole-repo режимі (`changed = undefined`) + conformance для названого rule, як поточний scoped mode. `lint <rule>/<concern>` не додається цією спеціфікацією.

Fail-fast лишається як зараз:

- `readOnly:true` — перший ненульовий lint concern завершує прогін
- fix-mode — збирає найгірший code і продовжує, щоб дати deterministic/LLM fix-крокам шанс

---

## Implementation impact

Мінімальний список змін — усі виконуються разом (один breaking commit):

| зона                | що змінити                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema              | додати `npm/schemas/concern.json`; видалити `target.json` schema; оновити `v8r-catalog.json`                                                                                                 |
| Metadata parser     | новий `concern-meta.mjs` (parser/normalizer); видалити `parseRuleLintSpec` з `rule-meta.mjs`                                                                                                 |
| Lint orchestration  | `run-lint.mjs`: вибирати lint-surfaces з `concern.json`, видалити `readAllMeta` / `selectLintRules` по `main.json.lint`                                                                      |
| Check discovery     | `discover-checkable-rules.mjs`: сканувати `*/concern.json`, видалити `js/*.mjs` / `policy/*/target.json` шляхи                                                                               |
| Rule runner         | `run-rule.mjs`: запускати `check` і `policy` surfaces з concern descriptor; видалити `resolveJsCheckPath`                                                                                    |
| Policy runner       | `run-conftest-batch.mjs:76`: прибрати хардкод `policy/`; приймати `<rule>/<concern>` flat path                                                                                               |
| Templates/docs sync | `appendDiscoveredMdcFiles`: сканувати `*/*.mdc` де є `concern.json`; видалити `js/` і `policy/` гілки; оновити всі `.mdc`/docs посилання з `./policy/...` і `./js/...` на flat concern paths |
| T0 autofix          | `discover-t0-patterns.mjs`: сканувати `*/fix-*.mjs` у concern dirs (з перевіркою `concern.json`)                                                                                             |
| Conformance         | `npm-module/js/rule_meta.mjs`: валідувати `concern.json`; забороняти `js/`, `policy/`, `main.json.lint`                                                                                      |
| Docs/rules          | оновити `scripts.mdc`, `conftest.mdc`, `n-bun.mdc`, `n-rego.mdc`, generated `.cursor/rules/*` після sync                                                                                     |
| Rule `main.mjs`     | видалити всі 36 перевірених `rules/<id>/main.mjs`; `run-standard-rule.mjs` видалити; `check-mjs-contract.test.mjs` переписати як concern-discovery contract test                             |
| Conformance runner  | `run-conformance-check.mjs`: замінити спавн `bun rules/<id>/main.mjs` на inline concern execution без subprocess; зберегти rule-level `withLock(fix-${ruleId})` семантику в новому runner    |

Exit criteria:

- `run-lint` у delta, hook, scoped і `--full` режимах — snapshot-тести по concern selection;
- `run-rule` — тести для pure `check`, pure `policy`, pure `lint`, і multi-surface concern;
- `npm-module` validation — fail на будь-який rule з `js/`, `policy/`, `main.json.lint`, `target.json`.

## Міграція

### `main.json` — прибрати `lint` і `llmFix`

| правило                                                                         | було                                     | після                                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `doc-files`                                                                     | `{ "lint": "per-file", "llmFix": true }` | `{}`                                                             |
| `text`                                                                          | `{ "lint": "per-file", "llmFix": true }` | `{}`                                                             |
| `js`, `style`                                                                   | `{ "lint": "per-file" }`                 | `{}`                                                             |
| `security`                                                                      | `{ "lint": "per-file" }`                 | `{}`; фактичний concern стає `full`, бо trufflehog ігнорує files |
| `bun`, `docker`, `ga`, `image-compress`, `k8s`, `php`, `python`, `rego`, `rust` | `{ "lint": "full" }`                     | `{}`                                                             |

### Concern inventory після міграції

Поточний `js/main.mjs::lint` вже містить три логічні lint concerns: eslint/oxlint, jscpd і knip. Їх треба розділити в межах цієї міграції, інакше `lint --full` втратить наявну функціональність.

| правило          | concern             | scope    | llmFix | glob / trigger                                                                                                            | примітка                                       |
| ---------------- | ------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `doc-files`      | `check/`            | per-file | ✓      | `**/*.{js,mjs,ts,vue,py}` + docs reverse-map у коді                                                                       | зберегти orphan detect                         |
| `js`             | `eslint/`           | per-file | —      | `**/*.{js,mjs,cjs,jsx,ts,tsx,vue}`                                                                                        | oxlint + eslint по changed                     |
| `js`             | `jscpd_config/`     | —        | —      | —                                                                                                                         | policy only: Rego-перевірка `.jscpd.json`      |
| `js`             | `jscpd_duplicates/` | full     | —      | `**/*.{js,mjs,cjs,jsx,ts,tsx,vue}`                                                                                        | lint only: `bunx jscpd .`                      |
| `js`             | `knip/`             | full     | —      | `package.json`, `**/package.json`, `tsconfig*.json`, `**/*.{js,mjs,cjs,jsx,ts,tsx,vue}`                                   | поточний full branch                           |
| `security`       | `scan/`             | full     | —      | `**/*`                                                                                                                    | trufflehog filesystem scan ігнорує files       |
| `style`          | `lint/`             | per-file | —      | `**/*.{css,scss,vue}`                                                                                                     | —                                              |
| `text`           | `check/`            | full     | ✓      | `**/*.{md,mdc,txt,json,jsonc,yaml,yml,toml,sh,env}`, `.env*`, `.cspell.json`, `.markdownlint-cli2.jsonc`, `.oxfmtrc.json` | поточний lint ігнорує files і сканує весь repo |
| `bun`            | `licensee/`         | full     | —      | `package.json`, `bun.lock`, `.licensee.json`                                                                              | —                                              |
| `docker`         | `lint/`             | full     | —      | `**/Dockerfile*`                                                                                                          | —                                              |
| `ga`             | `workflows/`        | full     | —      | `.github/workflows/**`                                                                                                    | —                                              |
| `image-compress` | `check/`            | full     | —      | `**/*.{jpg,png,svg}`                                                                                                      | —                                              |
| `k8s`            | `manifests/`        | full     | —      | `k8s/**/*.yaml`                                                                                                           | —                                              |
| `php`            | `check/`            | full     | —      | `**/*.php`                                                                                                                | —                                              |
| `python`         | `check/`            | full     | —      | `**/*.py`                                                                                                                 | —                                              |
| `rego`           | `check/`            | full     | —      | `**/*.rego`                                                                                                               | —                                              |
| `rust`           | `check/`            | full     | —      | `**/*.rs`                                                                                                                 | —                                              |

### Rule-level `main.mjs` і `applies.mjs`

Фактичний inventory на момент ревізії: 36 `rules/<id>/main.mjs`. Усі вони видаляються. Standalone-запуск (`bun rules/<id>/main.mjs`) більше не підтримується; CLI-еквівалент — `n-cursor check <id>`.

4 файли `js/applies.mjs` (`abie`, `python`, `rego`, `rust`) видаляються без заміни. Поведінка їхніх root/file predicates свідомо втрачається; після міграції `resolveCheckRuleIds` відповідає лише за active rule list із `.n-cursor.json`.

### Links/templates/docs sweep

Міграція flat concern paths включає обов'язковий sweep посилань:

- `./policy/<concern>/template/...` → `./<concern>/template/...`
- `./policy/<concern>/<file>` → `./<concern>/<file>`
- `./js/<concern>.mdc` або `./js/<concern>/...` → `./<concern>/...`
- generated docs у `npm/rules/*/docs/` оновлюються або регенеруються після переносу

Для `jscpd_config`: посилання на `./policy/jscpd/template/.jscpd.json.snippet.json` переходять на `./jscpd_config/template/.jscpd.json.snippet.json`.

### Policy migration inventory

Фактичний inventory на момент ревізії: **67** auto-discovered `target.json` у **28** rules:

`abie`, `adr`, `bun`, `capacitor`, `ci4`, `docker`, `efes`, `ga`, `hasura`, `image-avif`, `image-compress`, `js`, `js-bun-db`, `js-bun-redis`, `js-mssql`, `js-run`, `k8s`, `npm-module`, `php`, `python`, `rego`, `rust`, `security`, `style`, `test`, `text`, `vue`, `worktree`.

`graphql`, `nginx-default-tpl`, `tauri` треба окремо audit-нути: у них є policy references / ручні `runConftestBatch`-виклики або policy-директорії без auto-discovered `target.json`. Міграція має або дати їм `concern.json#policy`, або явно залишити як non-discovered helper policy.

Для кожного `target.json`:

- `files` → `concern.json#policy.files`
- `check` → `concern.json#policy.check`
- `missingMessage` → `concern.json#policy.missingMessage`
- `$schema` → новий `$schema` на `concern.json`

Для кожного Rego concern:

- `<concern>.rego` package → `<rule_id_snake>.<concern_id>`
- `<concern>_test.rego` package → `<rule_id_snake>.<concern_id>_test`
- test imports → `data.<rule_id_snake>.<concern_id>`
- старі namespaces не підтримуються compatibility shim-ами

---

## Валідація схеми

`npm-module` перевіряє структуру правил (`js/rule_meta.mjs`). Після міграції додати перевірки:

- кожен підкаталог у `rules/<id>/` або має `concern.json`, або є в allowlist non-concern dirs (`utils/`, `lib/`, `docs/`, `coverage/`); `js/` і `policy/` не входять в allowlist і є помилкою після one-step migration
- `concern.json` має хоча б одну surface: `check`, `policy`, `lint`
- `lint.scope` — тільки `"per-file"` або `"full"`
- `policy.files` валідний за старою семантикою `target.json`: рівно один із `single` / `walkGlob`
- `policy.check` — тільки `"template"` або відсутній
- `policy.missingMessage` дозволений тільки разом із `policy.files.single`
- якщо `lint.scope:"full"` і `lint.glob` відсутній — warning/error у `npm-module`, бо concern ніколи не запуститься в delta-режимі
- якщо concern має `check:true`, у `main.mjs` має бути export `main`
- якщо concern має `lint`, у `main.mjs` має бути export `lint`
- якщо concern має `policy` без `check:"template"`, має існувати `<concern>.rego`
- якщо concern має `policy.check:"template"`, має існувати `template/` з хоча б одним supported template-файлом
- після cleanup-фази не має лишитися `main.json.lint`, `main.json.llmFix`, `policy/*/target.json`, discovery-concern файлів `js/*.mjs`

---

## Не в цій спеці

- **Нові lint capabilities**, яких зараз немає (наприклад type-check) — наступна задача після міграції. Наявні `jscpd` і `knip` у `js/main.mjs::lint(undefined)` не є новими capabilities і мігруються тут.
- **Вісь поведінки fix/read-only** — `2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`
- **LLM-fix деталі** — `2026-06-15-opportunistic-llm-fix-tier.md`
- **`lint <rule>/<concern>` CLI selector** — не додається тут; ця спека тільки міняє внутрішню одиницю orchestration.
