---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T10:06:54+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Напишу ADR-и безпосередньо на основі транскрипту.

## ADR Уніфікація CI-команд на `n-cursor lint <rule> --read-only`

## Context and Problem Statement
Чотири GitHub Actions workflow'и (lint-ga, lint-text, lint-js, lint-style) використовували різнорідні команди: `bun run lint-ga`, `n-cursor lint-text --read-only`, багаторядковий `bunx oxlint / bunx eslint . / bunx jscpd . / bunx knip --no-config-hints`, `npx stylelint '**/*.{css,scss,vue}'`. Кожен workflow описував окремий набір CLI-інструментів напряму, без спільної точки оркестрації.

## Considered Options
* Замінити всі CI `run:`-кроки на `n-cursor lint <rule> --read-only`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити всі CI `run:`-кроки на `n-cursor lint <rule> --read-only`", because scoped `n-cursor lint <rule>` запускає лінтер і конформність правила (= standalone `lint-<rule>`), тож CI не мусить перелічувати окремі CLI-інструменти.

### Consequences
* Good, because CI-кроки стають однорідними та не розходяться з локальним запуском.
* Good, because conftest у CI підтягується авто-install'ом через `ensureTool` без явних install-кроків.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `.github/workflows/lint-{ga,text,js,style}.yml`; відповідні Rego-шаблони і тести в `npm/rules/{ga,text,js-lint,style-lint}/policy/lint_*_yml/`; workflow-приклади у `.cursor/rules/n-{ga,text,js-lint,style-lint}.mdc` (mirror'и регенеровано з джерел `npm/rules/*/*.mdc`). Нові команди:
- `n-cursor lint ga --read-only`
- `n-cursor lint text --read-only`
- `n-cursor lint js-lint js-lint-ci --read-only`
- `n-cursor lint style-lint --read-only`

---

## ADR Видалення umbrella `lint` скрипта і всіх `lint-*` обгорток із кореневого `package.json`

## Context and Problem Statement
Кореневий `package.json` містив скрипт `lint`, який агрегував виклики `bun run lint-*` і завершувався `&& oxfmt .`, а також окремі скрипти-обгортки (`lint-js`, `lint-ga`, `lint-text`, `lint-style`, `lint-security`, `lint-rego`). При наявності `n-cursor lint` як єдиної точки оркестрації ці обгортки стали дубляжем. Постало питання, як позбутись агрегатного `lint`: видалити повністю чи замінити тонким аліасом.

## Considered Options
* **Option A:** прибрати `"lint"` зовсім; єдина точка — `n-cursor lint` (з `--full` / scoped-варіантами)
* **Option B:** `"lint": "n-cursor lint --full"` як тонкий аліас

## Decision Outcome
Chosen option: "Option A", because користувач явно обрав Option A — «прибрати `"lint"` зовсім; єдина точка = `n-cursor lint`».

### Consequences
* Good, because `package.json` scripts скорочуються до `{start, test, coverage}` без дублювання логіки оркестрації.
* Good, because oxfmt тепер виконується всередині `n-cursor lint` у fix-режимі, не потребуючи окремого суфікса в агрегаторі.
* Bad, because видалення umbrella потребувало також прибирання bun-агрегат-секції з `npm/rules/bun/policy/package_json/package_json.rego` (4 deny-правила і helperi) і відповідних тестів.

## More Information
Фінальні `scripts` у `package.json`: `{"start": "bun ./npm/bin/n-cursor.js", "test": "vitest run", "coverage": "n-cursor coverage"}`. Прибрано bun-агрегат у `npm/rules/bun/policy/package_json/package_json.rego` і відповідні тести в `npm/rules/bun/policy/package_json/package_json_test.rego`. Перевірка конформності: `n-cursor lint bun --read-only` → exit 0.

---

## ADR Повна чистка script-вимог для always-active правил (без мінімального підходу)

## Context and Problem Statement
Package.json-політики кількох правил (`ga`, `js-lint`, `style-lint`, `security`, `rego`) вимагали наявності відповідних `lint-*` скриптів у `package.json` consumer-репо. Після видалення umbrella постало питання: прибрати всі ці вимоги («повна чистка») чи лишити скрипти як локальну зручність («мінімум»).

## Considered Options
* **Мінімум:** лишити 3 mandated-аліаси (`lint-ga`, `lint-js`, `lint-style`), прибрати лише `lint-text`/`lint-security`; не чіпати 3 package_json-політики
* **Повна чистка:** прибрати script-вимоги з усіх always-active package_json-політик (ga, rego, security, js-lint, style-lint) і bun-агрегата

## Decision Outcome
Chosen option: "Повна чистка", because користувач явно обрав «Повна чистка» після пояснення обсягу.

### Consequences
* Good, because consumer-репо більше не зобов'язані тримати `lint-*` скрипти; `n-cursor lint <rule>` є достатньою точкою виклику.
* Bad, because знадобилось видалити/переписати package_json-політики і тести для ga, rego, docker (відкочено), python (відкочено), security, js-lint, style-lint — а також виявлено JS-side перевірки (хардкод у `npm/rules/text/js/formatting.mjs`, `npm/rules/js-lint/js/tooling.mjs`, `npm/rules/style-lint/js/tooling.mjs`), які теж потребували правки.

## More Information
Видалено цілі теки: `npm/rules/ga/policy/package_json/`, `npm/rules/rego/policy/package_json/`. Прибрано script-секції з: `npm/rules/js-lint/policy/package_json/template/package.json.snippet.json`, `npm/rules/security/policy/package_json/` (template/snippet + contains). Видалено `npm/rules/style-lint/policy/package_json/template/package.json.contains.json`. Бун-агрегат прибрано з `npm/rules/bun/policy/package_json/package_json.rego`. Усі зміни верифіковано через `conftest verify` (зелено) і повний `vitest run` (2428 passed).

---

## ADR Відкладення міграції умовних правил (`docker`, `python`, `k8s`, `image`, `php`, `rust`)

## Context and Problem Statement
Умовні правила (docker, python, k8s, image-avif, image-compress, php, rust) мали package_json-вимоги `lint-*` скриптів, як і always-active правила. Проте їхні CI-політики (`lint_docker_yml` тощо) хардкодять `bun run lint-docker` / `bun run lint-python`; видалення скриптів без міграції CI-політик залишило б active-consumer-репо у зламаному напівстані.

## Considered Options
* Мігрувати CI-політики умовних правил разом із always-active (в рамках тієї ж задачі)
* Відкласти міграцію умовних правил на окрему задачу; відкотити передчасну чистку

## Decision Outcome
Chosen option: "Відкласти міграцію умовних правил; відкотити передчасну чистку", because агент почав видаляти docker/python package_json-політики, але виявив, що `npm/rules/docker/policy/lint_docker_yml/template/lint-docker.yml.snippet.yml` хардкодить `bun run lint-docker`, і відкотив зміни командою `git checkout 46e10061 -- npm/rules/docker/policy/package_json npm/rules/python/policy/package_json npm/rules/docker/docker.mdc npm/rules/python/python.mdc`. Додаткова причина: php/rust/image мають `lint-*` як справжню тул-команду (cargo, minify-image), а не n-cursor-обгортку.

### Consequences
* Good, because consumer-репо з активними правилами docker/python не ламаються після мержу.
* Neutral, because умовні правила лишилися в асиметричному стані (always-active — чисті; умовні — з обгортками), що зафіксовано у пам'яті проєкту як технічний борг.

## More Information
Відкочені файли: `npm/rules/docker/policy/package_json/`, `npm/rules/python/policy/package_json/`, `npm/rules/docker/docker.mdc`, `npm/rules/python/python.mdc` — відновлено до коміту `46e10061`. Наступна задача: мігрувати `lint_docker_yml` / `lint_python_yml` Rego-політики на `n-cursor lint docker --read-only` / `n-cursor lint python --read-only` та оновити `npm/rules/bun/js/layout.mjs` (`RULE_SCRIPTS`).

---

## ADR Правка джерел mdc і регенерація mirror'ів (не пряме редагування mirror'ів)

## Context and Problem Statement
`.cursor/rules/n-*.mdc` — це mirror-файли, що генеруються з джерел `npm/rules/*/*.mdc` через `inlineTemplateLinks`. На початку сесії крок 2 правив mirror'и напряму (без правки джерел), що спричиняло mirror-parity drift і ризик відкату при наступній синхронізації.

## Considered Options
* Правити mirror'и напряму (`.cursor/rules/n-*.mdc`)
* Правити джерела (`npm/rules/*/*.mdc`), тоді регенерувати mirror'и через `npm/scripts/lib/mirror-parity.mjs`

## Decision Outcome
Chosen option: "Правити джерела, тоді регенерувати mirror'и", because `mirror-parity.mjs` визначає очікуваний вміст mirror'а як `inlineTemplateLinks(джерело)`, і будь-яке пряме редагування mirror'а буде перезаписано при наступній регенерації.

### Consequences
* Good, because регенерація (12 mirror'ів) заодно усунула pre-existing drift, накопичений попередніми комітами (js-lint-ci, js-run, vue, test, worktree).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Регенерацію виконано через: `node --input-type=module` з імпортом `findMirrorDrift` та `regenerateMirrors` з `npm/scripts/lib/mirror-parity.mjs`. Після регенерації: drift = none. Правлені джерела: `npm/rules/{bun,ga,rego,security,python,docker,js-lint,style-lint,text}/*.mdc`. Regenerated mirrors: `n-{bun,ga,js-lint,js-lint-ci,js-run,python,rego,security,style-lint,test,vue,worktree}.mdc`.
