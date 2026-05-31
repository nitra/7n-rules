---
session: 27bcf8ad-3d79-4564-975c-e30f0be45f1d
captured: 2026-05-31T20:41:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/27bcf8ad-3d79-4564-975c-e30f0be45f1d.jsonl
---

Готово.

**Підсумок:**
- Прозовий опис у `.mdc` більше не містить літерала `^3.10.0`; замість нього — покликання на сам snippet (`package.json.snippet.json`) — єдине джерело
- Snippet, Rego enforcement, приклад у `.mdc`, тести — все синхронно
- `opa test` → 8/8; regal → 0 порушень; `opa fmt` чисто

---

## ADR відмова від генерації `oxlint-canonical.json` і перехід до прямого редагування

## Context and Problem Statement

У репо існував пайплайн генерації: `oxlint-rules.tsv` + `oxlint-canonical-skeleton.json` → скрипт `rebuild-oxlint-canonical.mjs` → `oxlint-canonical.json`. JSON уже містив усі дані і де-факто використовувався як єдине джерело; TSV і скелет дублювали його та потребували синхронізації.

## Considered Options

* Залишити генераційний пайплайн (TSV + skeleton → rebuild-скрипт → JSON) — як було до зміни; TSV простіший для diff, але вимагає окремого rebuild-кроку та синхронізації трьох файлів
* Видалити генерацію, редагувати `oxlint-canonical.json` напряму як source-of-truth

## Decision Outcome

Chosen option: "Видалити генерацію, редагувати `oxlint-canonical.json` напряму", because JSON і TSV вже містили однакові дані 1:1 (генерація не давала практичної переваги), а зайвий rebuild-крок тільки ускладнював розуміння структури.

### Consequences

* Good, because усунуто три артефакти (`oxlint-rules.tsv`, `oxlint-canonical-skeleton.json`, `rebuild-oxlint-canonical.mjs`), `lib/` каталог зник; правило про source-of-truth тепер однозначне
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Видалено через `git rm`: `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`, `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`, `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`. Прибрано entry `rules/js-lint/lib/rebuild-oxlint-canonical.mjs` з `knip.json`. Оновлено `.v8rignore`. Обидва `.mdc` (`npm/rules/js-lint/js-lint.mdc`, `.cursor/rules/n-js-lint.mdc`) виправлено: застарілий шлях `js/tooling/` → `js/data/tooling/`, прибрано інструкцію запуску rebuild. Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch/Changed). `bun test rules/js-lint/js/tests/tooling.test.mjs` → 12 pass.

---

## ADR підняття мінімальної версії `@nitra/eslint-config` до `3.10.0` із виносом у snippet

## Context and Problem Statement

Мінімальна версія `@nitra/eslint-config` була захардкоджена числами в Rego-логіці (`parts[1] >= 10`, `>= 3.9.2`), окремо дублювалася в коментарях, `.mdc`-тексті й `tooling.mjs`. Потрібно було підняти мінімум до `3.10.0` і водночас прибрати дублювання: однозначне джерело мало керувати і enforcement-ом, і документацією.

## Considered Options

* Просто замінити магічні числа в Rego (`3.9.2 → 3.10.0`) — часткова правка без усунення дублювання
* Винести мінімальну версію в `template/package.json.snippet.json` як єдине джерело; Rego читає поріг звідти; `.mdc`-проза посилається на snippet замість повторення числа

## Decision Outcome

Chosen option: "Винести мінімальну версію в snippet", because snippet вже є canonical template для `type` та `lint-js`; додавання до нього `devDependencies` робить його повним canonical зразком `package.json` і усуває необхідність дублювати поріг у Rego й документації.

### Consequences

* Good, because наступний бамп мінімальної версії — зміна одного значення в snippet; Rego enforcement, повідомлення і `.mdc`-проза підхоплюють автоматично
* Good, because transcript фіксує очікувану користь: усунуто `var-shadows-builtin` (перейменування `floor` → `min_parts`), `defer-assignment` і `messy-rule` в Rego при рефакторингу логіки; regal → 0 порушень
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінено: `npm/rules/js-lint/policy/package_json/template/package.json.snippet.json` (додано `devDependencies`), `npm/rules/js-lint/policy/package_json/package_json.rego` (читає `eslint_min_range` зі snippet, узагальнений `semver_gte`), `npm/rules/js-lint/policy/package_json/package_json_test.rego` (template_data містить поріг, новий тест `test_eslint_floor_driven_by_snippet`). Кореневий `package.json`: `^3.9.4 → ^3.10.0`; `bun install` встановив `@nitra/eslint-config@3.10.0`. `.mdc` (`js-lint.mdc`, `n-js-lint.mdc`) версія `1.28`: прозовий літерал `^3.10.0` замінено посиланням на snippet. Change-файл: `npm/.changes/1780248426182-7741d0.md` (minor/Changed). `opa test` → 8/8; `opa fmt` → чисто; `regal lint` → 0 порушень.
