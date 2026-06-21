---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T08:46:19+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Підготую ADR-документи безпосередньо на основі транскрипту.

## ADR Інтеграція python-правила в n-cursor lint оркестратор

## Context and Problem Statement
`npm/rules/python/meta.json` не мав поля `lint`, тому `n-cursor lint --full` повністю пропускав python-лінтинг (ruff/mypy). При цьому логіка `lint/lint.mjs` у правилі вже існувала, але оркестратор не знав про неї.

## Considered Options
* Додати `"lint": "full"` до `python/meta.json` і створити адаптер `js/lint.mjs`, що делегує в `lint/lint.mjs` (Варіант A)
* Лишити python окремою підкомандою/кроком поза оркестратором (Варіант B)

## Decision Outcome
Chosen option: "Варіант A — адаптер + meta lint:full", because це відповідає патерну всіх інших правил (ga, rego, security мають `js/lint.mjs`) і дозволяє `n-cursor lint --full` покривати python без окремих скриптів.

### Consequences
* Good, because `n-cursor lint --full` тепер охоплює python без дублювання логіки; адаптер передає прапор `readOnly` щоб CI не мутував файли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/python/meta.json` (`"lint": "full"`), `npm/rules/python/js/lint.mjs` (новий адаптер), `npm/rules/python/lint/lint.mjs` (доданий параметр `readOnly`), `npm/rules/python/js/docs/lint.md` (doc із CRC `a0d17a44`).

---

## ADR Інтеграція oxfmt у n-cursor lint (fix-режим)

## Context and Problem Statement
`oxfmt .` викликався лише як окремий скрипт `"oxfmt": "oxfmt ."` у кореневому `package.json` і ніколи не виконувався через `n-cursor lint`. Існував конкуруючий ADR «відокремлення-oxfmt-від-lint-ланцюжка.md» (статус Accepted), що пропонував лишити oxfmt окремим через принцип «лінтер не мутує файли».

## Considered Options
* Інтегрувати oxfmt у `orchestrate.mjs` як whole-tree крок у fix-режимі (не `--read-only`)
* Лишити oxfmt окремим скриптом у `package.json` (позиція попереднього ADR)

## Decision Outcome
Chosen option: "Інтеграція в orchestrate.mjs", because `n-cursor lint` у fix-режимі вже мутує файли (`eslint --fix`, `stylelint --fix`, `ruff --fix`, `markdownlint --fix`) — oxfmt семантично консистентний з цим набором. Конкуруючий ADR видалено.

### Consequences
* Good, because oxfmt більше не пропускається при локальному запуску `n-cursor lint`; в `--read-only` (CI) він не викликається — мутацій нема.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/rules/lint/js/orchestrate.mjs` (new `runOxfmt()` функція, виклик у `runLint` перед per-file фазою при `!readOnly`). Видалений файл: `docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md`.

---

## ADR Розширення семантики scoped 'lint \<rule\>' — лінтер + конформність

## Context and Problem Statement
`n-cursor lint <rule>` виконував **лише конформність** (Rego-перевірку) правила, ігноруючи `js/lint.mjs` лінтер. Standalone-підкоманди `lint-ga`, `lint-text`, `lint-js` виконували **лише лінтер** без конформності. Не існувало жодної команди, яка б запускала обидва кроки для одного правила.

## Considered Options
* `n-cursor lint <rule>` = лінтер (`js/lint.mjs`) + конформність (нова семантика)
* Залишити conformance-only (статус-кво)
* Новий прапор `--linter-only` для окремого запуску

## Decision Outcome
Chosen option: "лінтер + конформність для scoped-виклику", because це робить `n-cursor lint ga` еквівалентом `bun run lint-ga` і усуває семантичний розрив між двома підходами. Зворотна сумісність: правила без `js/lint.mjs` (наприклад, `changelog`) виконують лише конформність — поведінка незмінна.

### Consequences
* Good, because `n-cursor lint <rule>` стає повним аналогом `lint-<rule>` скриптів; `hk.pkl` (виклик `lint changelog`) залишається сумісним.
* Bad, because transcript фіксує: scoped-виклик у CI тепер тягне конформність, тобто вимагає доступності `conftest` (вирішується авто-install через `ensureTool`).

## More Information
Нова функція `runScopedRules()` у `npm/rules/lint/js/orchestrate.mjs`. Тести: `npm/rules/lint/js/tests/orchestrate.test.mjs` (5/5, додано probe-тест з/без `js/lint.mjs`). Кастомний `rulesDir` (юніт-тести) пропускає конформність — той самий guard, що і в `--full`.

---

## ADR Стандартизація CI-виклику lint на bare 'n-cursor lint \<rule\> --read-only'

## Context and Problem Statement
CI-воркфлоу використовували різні форми виклику: `bun run lint-ga`, `bunx oxlint && bunx eslint .`, `npx stylelint`. Форми з `npx`/`bunx @nitra/cursor` для scoped-пакета з одним bin мовчки повертають 0 без виконання (задокументований footgun у `n-ga.mdc`). Після переходу на scoped `lint <rule>` потрібна єдина надійна форма.

## Considered Options
* `bun ./node_modules/.bin/n-cursor lint <rule> --read-only` (Варіант B2 — прямий bin-шлях)
* `bun run lint-<rule>` (статус-кво, через package.json-обгортку)
* bare `n-cursor lint <rule> --read-only` (Варіант B3 — bin-ім'я)

## Decision Outcome
Chosen option: "bare `n-cursor lint <rule> --read-only`", because збігається з наявним прецедентом у `text`-правилі та уникає npx-silent-0 бага (проблема лише в `npx/bunx @nitra/cursor`, не в bare bin-ім'ям). Variant 2-full: scoped виклик включає conformance — дає детекцію drift конфігурації як бонус.

### Consequences
* Good, because єдина форма виклику по всіх 4 воркфлоу; CI отримує і лінтер, і конформність правила.
* Good, because transcript фіксує: conftest авто-встановлюється через `ensureTool` — явні install-кроки у воркфлоу не потрібні (окрім ga, де вже є).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені воркфлоу: `.github/workflows/lint-ga.yml` (`n-cursor lint ga --read-only`), `lint-text.yml` (`n-cursor lint text --read-only`; було `n-cursor lint-text` — subcommand-форма), `lint-js.yml` (`n-cursor lint js-lint js-lint-ci --read-only`), `lint-style.yml` (`n-cursor lint style-lint --read-only`). Rego-тести: 22/22 pass (`conftest verify`). Оновлені: `npm/rules/ga/policy/lint_ga/lint_ga.rego` (hardcoded gate), template-сніпети та `_test.rego` по 4 правилах, mdc-приклади у `.cursor/rules/n-ga.mdc`, `n-js-lint.mdc`, `n-style-lint.mdc`, `n-text.mdc`.

---

## ADR Повне видалення lint-* обгорток і umbrella-скрипта з кореневого package.json

## Context and Problem Statement
Кореневий `package.json` містив 9 lint-кроків (`lint-js`, `lint-ga`, `lint-text`, `lint-style`, `lint-security`, `lint-rego`, `lint-doc-files`, `lint-python`, `oxfmt`) і агрегатний скрипт `"lint"`, що їх послідовно викликав. Після інтеграції всіх кроків в `n-cursor lint` ці скрипти стали дублюванням оркестраційної логіки. Плюс `bun.package_json.rego` примусово вимагав існування агрегату й `&& oxfmt .`-суфіксу.

## Considered Options
* Видалити всі lint-* скрипти повністю, включно з `"lint"` (Варіант A — повна чистка)
* Лишити `"lint": "n-cursor lint --full"` як тонкий аліас (Варіант B)
* Мінімальна чистка: лишити mandated-аліаси (`lint-ga/js/style`), прибрати решту

## Decision Outcome
Chosen option: "Варіант A — повна чистка + видалення umbrella `lint`", because єдина точка входу — `n-cursor lint` (delta) і `n-cursor lint --full` (whole repo), без дублювання в package.json. Потребує переписування Rego-політик `bun.package_json`, `ga.package_json`, `js-lint.package_json`, `style-lint.package_json` та інших правил із script-вимогами.

### Consequences
* Good, because transcript фіксує очікувану користь: package.json зводиться до `{start, test, coverage}` — нульове дублювання lint-логіки.
* Bad, because transcript фіксує: видалення потребує каскадного rewrite published-канону в кількох Rego-політиках, template-ах, mdc-файлах і CI-воркфлоу — суттєвий blast radius по всіх consumer-репо, що успадковують ці канони.

## More Information
Rego-файли до переписування: `npm/rules/bun/policy/package_json/package_json.rego` (секція агрегованого lint-ланцюга і oxfmt-суфікса), `npm/rules/ga/policy/package_json/`, `npm/rules/js-lint/policy/package_json/`, `npm/rules/style-lint/policy/package_json/`. На момент закінчення транскрипту виявлено, що `docker`, `rego` та інші правила також мають lint-* script-вимоги — повний список ще уточнюється. Зміни `package.json` скасовуються авто-fix хуком, поки Rego-вимоги не прибрані.
