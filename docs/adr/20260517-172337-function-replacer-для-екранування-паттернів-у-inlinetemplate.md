---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T17:23:37+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Function-replacer для екранування `$`-паттернів у `inlineTemplateLinks`

## Context and Problem Statement
`inlineTemplateLinks` використовував `String.replace(needle, replacement)` зі string-replacement. TOML-сніпет `.gitleaks.toml.snippet.toml` містить `$'''` (raw strings у TOML), тому JavaScript-рушій інтерпретував `$'` як «рядок після збігу», і хвіст `.mdc`-документа реінжектувався всередину вбудованого блоку.

## Considered Options
* `String.replace(needle, () => replacement)` — function-replacer, JS його не інтерпретує як шаблон
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "function-replacer `() => replacement`", because це мінімальна зміна, яка унеможливлює будь-яку `$`-інтерпретацію без модифікації вмісту файлів-шаблонів.

### Consequences
* Good, because transcript фіксує очікувану користь: opa-sync `.cursor/rules/n-security.mdc` більше не містить артефактів реінʼєкції; 10/10 тестів GREEN.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/utils/inline-template-links.mjs` (рядок з `result.replace`), `npm/scripts/utils/__fixtures__/inline-template/fix/foo/template/with-dollar.toml`. Комміт: `3443730`. Версія: `1.13.7`.

---

## ADR Нормалізація label у вбудованих template-блоках (`normalizeTargetName`)

## Context and Problem Statement
Після вбудовування вміст `.mdc` показував `package.json.snippet.json:` як label, хоча читачу потрібен лише `package.json:`. Суфікси `.snippet.<ext>`, `.deny.<ext>`, `.contains.<ext>` — технічні ідентифікатори слоту, не імена реальних файлів.

## Considered Options
* `normalizeTargetName(basename)` — regex `^(.+)\.(snippet|deny|contains)\.[^.]+$` → group 1, застосовується до `basename` файла, незалежно від markdown-label
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`normalizeTargetName` з regex-strip суфіксів", because label береться з `basename` цільового файла (не з markdown-тексту посилання), а суфікс слоту прибирається — тоді `.cursor/rules/n-security.mdc` показує `package.json:` замість `package.json.snippet.json:`.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-security.mdc` (і `n-ga.mdc`, `n-rego.mdc`) відображають читабельні імена файлів; `findMissingMdcRefs("ga")` → `[]`; 14/14 unit tests GREEN.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/utils/inline-template-links.mjs` (`normalizeTargetName`), `npm/scripts/utils/inline-template-links.test.mjs` (4 нові drift-тести). Комміт: `6df1de2` (1.13.7), нормалізація додана в 1.13.8.

---

## ADR `LINT_TARGETS` у `runLintRego` виправлено на `npm/rules`

## Context and Problem Statement
`runLintRego` (викликається через `bun run lint-rego`) вказував на `LINT_TARGETS = ['npm/policy']` — шлях, що зник під час реструктуризації Phase 1 (v1.11.x). Реальні `.rego`-файли живуть у `npm/rules/*/policy/`. Функція мовчки виходила з кодом 0, не лінтуючи нічого.

## Considered Options
* Змінити `LINT_TARGETS` на `['npm/rules']`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`LINT_TARGETS = ['npm/rules']`", because це єдиний шлях, де реально розташовані `.rego`-файли після Phase 1 реструктуризації.

### Consequences
* Good, because transcript фіксує очікувану користь: `regal lint npm/rules` → 111 файлів, 0 violations; `opa test npm/rules` → 323/323 PASS; `conftest verify -p npm/rules` → 323 tests passed.
* Bad, because виявлено 156 прихованих regal violations (111 `directory-package-mismatch`, 28 `unresolved-reference`, 10 `test-outside-test-package`, 6 `opa-fmt`, 1 `line-length`), приховані через silent exit-0.

## More Information
Файли: `npm/rules/rego/lint/lint.mjs` (`LINT_TARGETS`), `npm/rules/rego/lint/lint.test.mjs` (3 інтеграційних тести: no-targets / broken-syntax / well-formed). Комміт: `81d8ea3` (1.13.10).

---

## ADR Конфігурація regal для інтенціональних відхилень проєкту

## Context and Problem Statement
Після виправлення `LINT_TARGETS` regal виявив 156 violations. Більшість — `directory-package-mismatch` (111 шт.) і `unresolved-reference` (28 шт.) — є інтенціональними конвенціями проєкту, а не помилками. Без конфігурації `regal lint` не може стати частиною CI.

## Considered Options
* Додати `.regal/config.yaml` з `level: ignore` для `directory-package-mismatch`, `unresolved-reference`, та `line-length.max-line-length: 220`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`.regal/config.yaml` з ігноруванням інтенціональних правил", because: (1) пакети `<rule>.<concern>` у `<rule>/policy/<concern>/` — встановлена конвенція проєкту; (2) `data.template.*` інʼєктується через `--data` runtime — regal не може зарезолвити статично; (3) `opa fmt` виробляє рядки до ~212 символів для інлайн-обʼєктів — ліміт 220 узгоджений з авто-форматтером.

### Consequences
* Good, because transcript фіксує очікувану користь: після конфіг + `opa fmt -w` + fix `test-outside-test-package` → `regal lint npm/rules` → 0 violations.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `.regal/config.yaml`. Також виправлено 4 файли з `test-outside-test-package`: `js-lint/policy/jscpd/jscpd_test.rego`, `js-lint/policy/vscode_extensions/vscode_extensions_test.rego`, `security/policy/gitleaks/gitleaks_test.rego`, `vue/policy/package_json/package_json_test.rego` — додано суфікс `_test` до package-name і явний `import data.<pkg>.<concern>`. Комміт: `81d8ea3` (1.13.10).

---

## ADR Міграція `ga` і `rego` policy-концернів на template/-driven canon (Phase 2 і Phase 3)

## Context and Problem Statement
Після Phase 1 (`security`) шаблонний підхід (`template/` + `resolveConcernTemplateData`) потребував поширення на `ga` (4 концерни) і `rego` (3 концерни), де канонічні значення були вшиті inline у Rego-правилах. Inline-literal ускладнює drift-detection та читабельність.

## Considered Options
* Продовжити той самий template/-pattern (Phase 2: `ga`, Phase 3: `rego`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "template/-driven canon (`.snippet`, `.contains`, `.deny` JSON/YAML) з drift-тестами у `*_test.rego`", because паттерн вже встановлений у Phase 1 (`security`), інфраструктура (`resolveConcernTemplateData`, `runConftestBatch`) — готова; вибір підтверджений user-ом: «ga (щойно зроблений)» → «брати rego».

### Consequences
* Good, because transcript фіксує очікувану користь: `opa test npm/rules` → 326/326 PASS; `bun run lint-rego` → 111 файлів, 0 violations; `n-cursor check ga` і `n-cursor check rego` → 1/1 без зауважень; `findMissingMdcRefs` → `[]` для обох правил.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`ga`: 4 template-файли (`package.json.contains.json`, `extensions.json.snippet.json`, `settings.json.snippet.json`, `zizmor.yml.snippet.yml`); комміт `3c98ecb` (1.13.9). `rego`: 3 template-файли (`package.json.snippet.json`, `extensions.json.snippet.json`, `settings.json.snippet.json`); комміт `b0efa4d` (1.13.11). Паттерн drift-тесту: `test_data_template_drives_*` у кожному `*_test.rego` передає навмисно змінене `data.template` і перевіряє, що `deny` реагує. Інвентаризація: `docs/adr/template-dir-concern-inventory.md`.
