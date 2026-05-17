---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T17:11:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Нормалізація label у вбудованих template/-блоках (inlineTemplateLinks)

## Context and Problem Statement
Функція `inlineTemplateLinks` підставляла в згенерований `.mdc`-блок label прямо з markdown-тексту першоджерела (напр. `[package.json.snippet.json](...)`). Результуючий `mdc`-заголовок виглядав як `` `package.json.snippet.json`: `` — суфікс `.snippet.json` не несе семантики для кінцевого читача.

## Considered Options
* Залишити label з markdown-тексту без змін.
* Нормалізувати label за базовим іменем файла, відкидаючи `.snippet.<ext>`, `.deny.<ext>`, `.contains.<ext>` суфікс.

## Decision Outcome
Chosen option: "Нормалізувати label за basename", because мета inline-блока — показати канонічний файл (`package.json`), а не внутрішню slot-конвенцію (`package.json.snippet.json`).

### Consequences
* Good, because transcript фіксує очікувану користь: рядок у `.cursor/rules/n-security.mdc` змінився з `` `package.json.snippet.json`: `` на `` `package.json`: ``.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Helper `normalizeTargetName(basename)` у `npm/scripts/utils/inline-template-links.mjs`: regex `^(.+)\.(snippet|deny|contains)\.[^.]+$` → group 1.
- Drift-тести (4 нові кейси) у `npm/scripts/utils/inline-template-links.test.mjs`.
- Bump `1.13.6` → `1.13.7`; зміна landнула разом із `$`-fix (коміт `6df1de2`).

---

## ADR Використання function-replacer у String.replace() для template-вмісту

## Context and Problem Statement
`inlineTemplateLinks` будував replacement-рядок і передавав його напряму у `String.prototype.replace(needle, replacement)`. TOML-канон (`.gitleaks.toml.snippet.toml`) містить `'''.*\.lock$'''` — послідовність із `$'`, яку JavaScript інтерпретує як «хвіст рядка після матчу», і хвіст `.mdc` реінжектувався всередину fenced-блока.

## Considered Options
* Залишити string-replacer.
* Використати function-replacer `result.replace(fullMatch, () => replacement)`.

## Decision Outcome
Chosen option: "function-replacer", because function-форма не інтерпретує `$`-патерни у поверненому значенні.

### Consequences
* Good, because transcript фіксує очікувану користь: `.cursor/rules/n-security.mdc` після fix-синку містить коректний TOML-блок без дублювання хвоста документа.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл `npm/scripts/utils/inline-template-links.mjs`, рядок ~42.
- Regression-фікстура `npm/scripts/utils/__fixtures__/inline-template/fix/foo/template/with-dollar.toml` (`paths = ['''.*\.lock$''']`).
- Відповідний тест «preserves $ characters in template content» у `inline-template-links.test.mjs`.
- Коміт `6df1de2`.

---

## ADR Виправлення LINT_TARGETS у runLintRego та конвенції regal-лінту

## Context and Problem Statement
`runLintRego` (в `npm/rules/rego/lint/lint.mjs`) мав `LINT_TARGETS = ['npm/policy']`. Директорія `npm/policy` перестала існувати після Phase 1 реструктуризації — всі `.rego` живуть у `npm/rules/*/policy/`. Через це `bun run lint-rego` мовчки виходив з кодом 0, не лінтуючи жодного файлу.

## Considered Options
* Оновити `LINT_TARGETS` до актуальних шляхів.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити LINT_TARGETS", because `npm/rules` є фактичним розташуванням усіх `.rego`-файлів; без виправлення весь rego-лінт був non-functional.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення `runLintRego` лінтує 111 файлів, `regal lint` знаходить і репортує реальні violations.
* Bad, because regal виявив 156 violations у вже існуючому коді, які потребували додаткових виправлень (описані нижче).

## More Information
- **LINT_TARGETS**: змінено з `['npm/policy']` на `['npm/rules']` у `npm/rules/rego/lint/lint.mjs`.
- **`.regal/config.yaml`** — додано три ignore-правила для інтенціональних конвенцій проєкту:
- `idiomatic.directory-package-mismatch: ignore` — package-назва `<rule>.<concern>` не відповідає шляху каталогу за конвенцією regal, але є свідомим вибором.
- `imports.unresolved-reference: ignore` — `data.template.*` інжектується через `--data` під час запуску conftest, regal не бачить джерела.
- `style.line-length: max: 200` — `opa fmt` тримає inline об'єкти/масиви в одному рядку; деякі перевищували дефолтний ліміт 120.
- **test-outside-test-package**: 4 файли (`js-lint/policy/jscpd`, `js-lint/policy/vscode_extensions`, `security/policy/gitleaks`, `vue/policy/package_json`) мали package `<rule>.<concern>` замість `<rule>.<concern>_test` і неявно посилалися на `deny` замість `<module>.deny`. Перейменовано та додано явний `import data.<rule>.<concern>`.
- `opa fmt -w npm/rules` — авто-форматування (6 файлів).
- Після всіх змін: `opa test npm/rules` → PASS 323/323; `regal lint npm/rules` → 0 violations.
- Нові unit-тести для `runLintRego` у `npm/rules/rego/lint/lint.test.mjs`.
- Bump `1.13.9` → `1.13.10`; коміт `81d8ea3`.
