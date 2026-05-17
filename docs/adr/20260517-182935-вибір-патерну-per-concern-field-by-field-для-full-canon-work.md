---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T18:29:35+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Вибір патерну per-concern field-by-field для full-canon workflow rego

## Context and Problem Statement
У ходь phase 3.5 міграції `ga` rule потрібно перевести 4 full-canon workflow-концерни (`clean_ga_workflows`, `clean_merged_branch`, `lint_ga`, `git_ai`) на template/-driven canon. На відміну від fragment-концернів, кожен rego перевіряє конкретний `.github/workflows/*.yml` через набір field-by-field deny-правил — тобто потенційно можна замінити все на один generic subset-of-walker.

## Considered Options
* Per-concern field-by-field: кожен rego читає `data.template.snippet` і перевіряє потрібні поля вручну
* Generic subset-of walker: один рекурсивний walker в rego перевіряє будь-який snippet як повне дерево (`a ⊆ b`)

## Decision Outcome
Chosen option: "Per-concern field-by-field (як є)", because так вирішив користувач явно під час сесії, щоб не вводити новий патерн і залишити кожен concern незалежним і читабельним без додаткової абстракції.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен rego-файл очевидно показує, які саме поля workflow є canонічними, без generic walker.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Вибір зроблено явно через `AskUserQuestion` з двома варіантами; user обрав першу опцію. Реалізовано у `npm/rules/ga/policy/clean_ga_workflows/clean_ga_workflows.rego`, `clean_merged_branch.rego`, `lint_ga.rego`, `git_ai.rego`. Комміт `55a6751` (v1.13.12).

---

## ADR Виправлення LINT_TARGETS з `npm/policy` на `npm/rules`

## Context and Problem Statement
`runLintRego` (`npm/rules/rego/lint/lint.mjs`) зберігав `LINT_TARGETS = ['npm/policy']` — шлях, що зник під час Phase 1 rule-реструктуризації. Реальні `.rego` файли перемістились у `npm/rules/`. Через це весь Rego-лінт тихо виходив з кодом 0 нічого не перевіривши — `opa check`, `regal lint`, `conftest verify` запускались, але не знаходили жодного файлу.

## Considered Options
* Оновити `LINT_TARGETS` на `['npm/rules']` + TDD-регресія
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити `LINT_TARGETS` на `['npm/rules']`", because саме там тепер живуть усі `.rego` файли після Phase 1 реструктуризації, а тихий silent-pass є критичною безпекою якості.

### Consequences
* Good, because transcript фіксує очікувану користь: після фіксу `regal lint` знайшов 156 прихованих violations; `opa check` охоплює 111 файлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Виправлення у `npm/rules/rego/lint/lint.mjs`. TDD-регресія у `npm/rules/rego/lint/lint.test.mjs` (3 тести: no-targets / broken-syntax / well-formed). Комміт `81d8ea3` (v1.13.10).

---

## ADR Конфігурація regal — ігнорування конвенційних violations

## Context and Problem Statement
Після виправлення `LINT_TARGETS` `regal lint npm/rules` виявив 156 violations. З них 139 є наслідком умисних конвенцій проєкту, а не помилок: package naming `<rule>.<concern>` не збігається з `npm/rules/<rule>/policy/<concern>/` (regal `directory-package-mismatch`), а `data.template.*` injected через `--data` runtime і regal не може їх зарезолвити (`unresolved-reference`). Додатково `opa fmt` форматує inline-об'єкти у single-line понад 120 символів, що тригерить `line-length`.

## Considered Options
* Додати `.regal/config.yaml` з `level: ignore` для трьох категорій
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `.regal/config.yaml` з `level: ignore`", because без цього або лінт вічно репортує false-positives (шум), або доведеться міняти усталені конвенції іменування пакетів і механізм ін'єкції `data.template`.

### Consequences
* Good, because transcript фіксує очікувану користь: після конфігу `regal lint` виходить з кодом 0, 111 файлів, 0 violations.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `.regal/config.yaml`. Ігноруються: `idiomatic.directory-package-mismatch` (конвенція `<rule>.<concern>`), `imports.unresolved-reference` (runtime `data.template.*`), `style.line-length.max-line-length: 220` (узгоджено з `opa fmt`). Комміт `81d8ea3` (v1.13.10).

---

## ADR Перейменування rego-тест-пакетів у `*_test` з явним імпортом

## Context and Problem Statement
Чотири тестових файли (`jscpd_test.rego`, `vscode_extensions_test.rego`, `gitleaks_test.rego`, `package_json_test.rego`) мали `package <rule>.<concern>` замість `package <rule>.<concern>_test`. Regal репортував `test-outside-test-package`: тест-правила (`test_*`) знаходились у продуктовому пакеті, що дозволяє тестам мовчки звертатись до `deny` без кваліфікованого шляху — якщо ім'я змінити, тест не впаде, він просто перестане бути тестом.

## Considered Options
* Перейменувати пакети в `<rule>.<concern>_test` і додати `import data.<rule>.<concern>`; кваліфікувати всі виклики `deny` через іменований пакет
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перейменувати в `*_test` + явний import", because це стандартна OPA-конвенція, що унеможливлює непомічений розрив між тестом і продуктовим пакетом.

### Consequences
* Good, because transcript фіксує очікувану користь: `regal lint` перестав репортувати `test-outside-test-package` після змін.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/js-lint/policy/jscpd/jscpd_test.rego`, `npm/rules/js-lint/policy/vscode_extensions/vscode_extensions_test.rego`, `npm/rules/security/policy/gitleaks/gitleaks_test.rego`, `npm/rules/vue/policy/package_json/package_json_test.rego`. Комміт `81d8ea3` (v1.13.10).

---

## ADR Коментар-обхід для `dry_run: no` у template YAML

## Context and Problem Statement
У `clean-merged-branch.yml` поле `dry_run: no` вирішується по-різному двома parsers: Go-yaml (conftest) читає `no` як bool `false`, а npm-пакет `yaml` (v1.2, JS) — як рядок `"no"`. Template-файл `clean-merged-branch.yml.snippet.yml` зберігає YAML, який conftest використовує напряму через `--data`; тому якщо template містить буквальне `no`, JS читає string і rego-check `is_string(input.with.dry_run)` виявляє violation у реальному репо.

## Considered Options
* Замінити `dry_run: no` на коментар `# dry_run: false` і hardcode `false` у rego
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Коментар + `false` у rego", because `false` — це те значення, яке Go-yaml (conftest) сам і повертає при парсингу `no`; коментар у template документує розрив між YAML-джерелом і rego-логікою.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor check ga` перейшов з 0/1 на 1/1 після зміни.
* Bad, because template вже не є точною копією workflow-файлу — потрібен коментар щоб пояснити розходження.

## More Information
Файл `npm/rules/ga/policy/clean_merged_branch/template/clean-merged-branch.yml.snippet.yml`, рядок `# \`no\` у workflow YAML = Go-yaml bool false`. Комміт `55a6751` (v1.13.12).
