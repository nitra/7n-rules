---
session: 27bcf8ad-3d79-4564-975c-e30f0be45f1d
captured: 2026-06-01T06:38:52+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/27bcf8ad-3d79-4564-975c-e30f0be45f1d.jsonl
---

(The next ADR output)

---

## ADR Відмова від генерації: `oxlint-canonical.json` як source-of-truth

## Context and Problem Statement
У репозиторії існував пайплайн генерації: `oxlint-canonical-skeleton.json` + `oxlint-rules.tsv` → `rebuild-oxlint-canonical.mjs` → `oxlint-canonical.json`. Користувач запитав, чи можна видалити `oxlint-rules.tsv`, оскільки JSON-файл уже містить усі ті самі дані.

## Considered Options
* Залишити `oxlint-rules.tsv` як джерело генерації (статус-кво)
* Видалити генераційний пайплайн і редагувати `oxlint-canonical.json` напряму як source-of-truth

## Decision Outcome
Chosen option: "Видалити генераційний пайплайн і редагувати `oxlint-canonical.json` напряму як source-of-truth", because дані в `oxlint-canonical.json` і `oxlint-rules.tsv` повністю збігалися 1:1, і TSV більше не давав практичної переваги над прямим редагуванням JSON.

### Consequences
* Good, because усунуто три файли (`oxlint-rules.tsv`, `oxlint-canonical-skeleton.json`, `rebuild-oxlint-canonical.mjs`) та відповідні записи у `knip.json` і `.v8rignore`; `tooling.test.mjs` — 12/12 pass після видалення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалено через `git rm`: `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`, `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`, `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`. Прибрано entry `rules/js-lint/lib/rebuild-oxlint-canonical.mjs` з `knip.json`. Оновлено `.v8rignore` (видалено skeleton-рядок та мертві рядки `npm/scripts/utils/…`). Оновлено текст у `npm/rules/js-lint/js-lint.mdc` і `.cursor/rules/n-js-lint.mdc` (v1.26 → v1.27), виправлено застарілий шлях `js/tooling/` → `js/data/tooling/`. Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch / Changed).

---

## ADR Мінімальна версія `@nitra/eslint-config` 3.10.0, enforcement через snippet

## Context and Problem Statement
Версія `@nitra/eslint-config` була захардкоджена як мінімальна `3.9.2` (пізніше підвищена до `3.10.0`) у Rego-файлі з магічними числами. Користувач попросив підняти поріг до `3.10.0` та зробити так, щоб політика enforce-ила версію з єдиного джерела.

## Considered Options
* Хардкодити мінімальну версію числами прямо у Rego-клаузах (`parts[1] >= 10`)
* Перенести мінімум у `template/package.json.snippet.json` і читати поріг звідти у Rego

## Decision Outcome
Chosen option: "Перенести мінімум у `template/package.json.snippet.json` і читати поріг звідти у Rego", because це єдине джерело істини: snippet вже є каноном `type`/`lint-js`-script для споживачів, тому природно тримати там і мінімальну залежність. Зміна мінімуму відтепер — одне значення в snippet, а Rego, deny-повідомлення і тести підхоплюють автоматично.

### Consequences
* Good, because `opa test` → 8/8 pass; `regal lint` → 0 порушень; `opa fmt` чисто; реальний `package.json` (`^3.10.0`) → deny `[]`; занижений `^3.9.4` → deny з інтерпольованим повідомленням.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/rules/js-lint/policy/package_json/template/package.json.snippet.json` — додано поле `"devDependencies": { "@nitra/eslint-config": "^3.10.0" }`. `package_json.rego` — `eslint_min_range` читається зі `data.template.snippet.devDependencies["@nitra/eslint-config"]`; узагальнений `semver_gte(actual, min_parts)` замінив три хардкодовані клаузи. `package_json_test.rego` — доданий `test_eslint_floor_driven_by_snippet`. Кореневий `package.json` оновлено до `^3.10.0`, `bun install` встановив `@nitra/eslint-config@3.10.0` (latest). `js-lint.mdc` v1.27 → v1.28 (прибрано літерал із прози, залишено посилання на snippet). Change-файл: `npm/.changes/1780248426182-7741d0.md` (minor / Changed).

---

## ADR Локальне правило `cursor-test.mdc` без `n-`-префіксу

## Context and Problem Statement
Потрібно додати локальне правило для cursor-репо з конвенціями тестів (мова `describe/test`, Stryker-aware маркери, inline test-фабрики). Правило специфічне для репо і не є частиною пакета `@nitra/cursor`.

## Considered Options
* Назвати файл `n-cursor-test.mdc` (за аналогією з керованими правилами)
* Назвати файл `cursor-test.mdc` (без `n-`-префіксу, як локальні `conftest.mdc`, `dev-dep.mdc`, `scripts.mdc`)

## Decision Outcome
Chosen option: "`cursor-test.mdc` без `n-`-префіксу", because синк `n-cursor` видаляє будь-який `.cursor/rules/n-*.mdc`, якого нема в `rules` із `.n-cursor.json`; додавати `cursor-test` у `.n-cursor.json` не можна — copy-крок шукав би пакетне правило `npm/rules/cursor-test/`, якого нема. Усі справді локальні правила репо йдуть без `n-`-префіксу.

### Consequences
* Good, because файл не буде автоматично видалено синком; відповідає конвенції локальних правил.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `.cursor/rules/cursor-test.mdc` v1.0. Містить три секції: мова describe/test (українська, винятки: символи коду, поля схем, API-ключі); Stryker-aware read-only маркери (`.n-cursor.json`, `COVERAGE.md`, `npm/reports/stryker/*.json`, кореневі `package.json`/`CHANGELOG.md`); inline test-фабрики (≤80 рядків, 1 файл). Citує `npm/rules/test/js/tests/stryker_config.test.mjs` (`makeProj`), `npm/tests/integration-repo-checks.test.mjs`, `npm/rules/test/js/tests/location.test.mjs`. Механізм видалення: `removeOrphanManagedRuleFiles` у `npm/bin/n-cursor.js` (рядки ≈535–565).

---

## ADR `js-lint-ci/meta.json`: авто-активація за JS/TS-glob

## Context and Problem Statement
`npm/rules/js-lint-ci/meta.json` не мав поля `auto`, через що правило `js-lint-ci` (jscpd + knip) ніколи не авто-активувалося під час синку і залишалося opt-in. Інші CI-правила (зокрема `rego`) вже використовували `{ "auto": { "glob": "**/*.rego" }, "lint": "ci" }`.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `auto.glob` для JS/TS-файлів у `js-lint-ci/meta.json`", because дзеркалює усталений патерн CI-правил у пакеті; `js-lint-ci` стає авто-активованим за наявності JS/TS-файлів, як і решта правил родини.

### Consequences
* Good, because тести `auto-rules`, `rule-meta`, `lint-cli` — 61/61 pass; `js-lint-ci` тепер повертається `detectAutoRules` для репо з JS/TS-файлами.
* Bad, because кореневий `.n-cursor.json` репо не містить `js-lint-ci` і відстане від авто-дискаверу до наступного синку (drift без падаючого тесту).

## More Information
Змінено: `npm/rules/js-lint-ci/meta.json` — додано `"auto": { "glob": ["**/*.mjs", "**/*.cjs", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"] }`. Поведінковий наслідок: на наступному синку `js-lint-ci` авто-додасться до `.n-cursor.json` і встановиться `.cursor/rules/n-js-lint-ci.mdc`. Потребує change-файлу в `npm` (поведінкова зміна пакета). Обговорювалося в transcript, але change-файл і оновлення `.n-cursor.json` лишилися невиконаними на момент завершення сесії.
