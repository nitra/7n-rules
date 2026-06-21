---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T13:22:02+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Ось ADR-документація для рішень цієї сесії:

---

## ADR Виведення `bun run lint-*` через `n-cursor lint <rule>` — єдина точка лінту

## Context and Problem Statement
Репозиторій мав ~10 окремих `lint-*` npm-скриптів (`lint-ga`, `lint-js`, `lint-docker` тощо) і один агрегований `scripts.lint`, що вибирав між ними. Це ускладнювало CI (кожне правило — свій `bun run lint-<rule>`), спричиняло дрейф між JS-перевірками і rego-політиками на команду, і унеможливлювало однорідний `n-cursor lint --full`.

## Considered Options
* Залишити `lint-*` скрипти як є (агрегат через `scripts.lint`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "замінити всі `bun run lint-<rule>` на `n-cursor lint <rule>`", because це дає єдину точку входу без агрегату, усуває дрейф CI ↔ JS-перевірок, і узгоджується з наявним `n-cursor lint --full`.

### Consequences
* Good, because transcript фіксує очікувану користь: CI воркфлоу (ga/text/js/style/python/php/docker/k8s) переведено на `n-cursor lint <rule> --read-only`; `bun run lint` і `lint-*` скрипти видалено з `package.json`; `2428+ тестів` зелені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Коміти: `9ba26f57` (крок 1+2), `afa24467` (крок 3 ядро), `3f722658` (mdc), `9dc2be76` (fix + revert docker/python). Файли: `package.json`, `.github/workflows/lint-{ga,text,js,style,python,php}.yml`, `npm/rules/*/policy/lint_*_yml/template/*.snippet.yml`.

---

## ADR Видалення `policy/package_json` для правил із `js/lint.mjs`-адаптером

## Context and Problem Statement
Для кожного правила існував rego-блок `policy/package_json`, що вимагав наявності `scripts.lint-<rule>` у `package.json` consumer'а. Після переходу на `n-cursor lint <rule>` ці мандати стали зайвими — скрипти більше не потрібні.

## Considered Options
* Залишити `policy/package_json` як застарілий (без enforcement)
* Видалити `policy/package_json` повністю для мігрованих правил
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "видалити `policy/package_json` для мігрованих правил", because застарілий мандат порушував би consumer'ів, що вже не мають `lint-*` скриптів.

### Consequences
* Good, because transcript фіксує очікувану користь: видалено `policy/package_json` у ga, rego, security, js-lint, style-lint, python, php, rust, docker, k8s; integration-тести зелені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені директорії: `npm/rules/{ga,rego,security,js-lint,style-lint,python,php,rust,docker,k8s}/policy/package_json/`. Відповідні conftest-пакети залишені (rego-тести для `lint_*_yml`).

---

## ADR Поетапна міграція умовних правил: Група 2 (python/php/rust) перед Групою 1 (docker/k8s/image)

## Context and Problem Statement
Умовні правила (docker/python/k8s/image/php/rust) мали `lint-*` скрипти, але частина з них (Група 1: docker/k8s/image) спільно тримала `checkCursorRuleScripts` у `bun/js/layout.mjs` — логіку, що перевіряла наявність `lint-<rule>` скриптів і потребувала окремого рефактора `RULE_SCRIPTS` + ~10 тестів.

## Considered Options
* Мігрувати всі 6 правил одним заходом (А→B→C)
* Мігрувати Група 2 (python/php/rust) + запушити, Група 1 окремо
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Група 2 спочатку, Група 1 окремо", because це дозволяє зафіксувати верифікований прогрес (python/php/rust) без ризику незавершеного bun layout рефактора.

### Consequences
* Good, because transcript фіксує очікувану користь: `f3413d14`/`5427cb57`/`526f1f61` запушено в main із зеленими тестами; docker/k8s виконано ізольовано в Групі 1.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли Група 2: `npm/rules/{python,php,rust}/js/lint.mjs` (нові адаптери), `npm/rules/{python,php,rust}/policy/lint_*_yml/template/*.yml` (CI), `npm/rules/{python,php,rust}/policy/package_json/` (видалені). Бранч `lint-orchestrate-unification` → `main`.

---

## ADR Рефактор `bun/js/layout.mjs`: видалення `RULE_SCRIPTS` + `checkCursorRuleScripts` пошагово для docker → k8s → image

## Context and Problem Statement
`bun/js/layout.mjs` містив `RULE_SCRIPTS` (список правил із мандатом `lint-<rule>`) та `checkCursorRuleScripts` — JS-аналог видаленого rego-мандату. Після переходу на `n-cursor lint` ця логіка стала застарілою. Оскільки docker/k8s/image спільно залежали від неї, її треба було прибирати синхронно з міграцією кожного правила.

## Considered Options
* Прибрати `RULE_SCRIPTS` / `checkCursorRuleScripts` одним коміт-кроком для всіх трьох
* Видаляти по одному (docker → k8s → image) разом із міграцією відповідного правила
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "видаляти по одному, разом із міграцією правила", because це мінімізує blast radius кожного коміту і дозволяє верифікувати тести після кожного кроку.

### Consequences
* Good, because transcript фіксує очікувану користь: після docker (`b25f6b50`) bun layout тести 14/14; після k8s (`b34cb289`) — 246/246.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/bun/js/layout.mjs`. Видалено: `WHITESPACE_RE`, `inChain()`, `RULE_SCRIPTS`, `checkCursorRuleScripts()`. Тест-файл: `npm/rules/bun/js/tests/layout.test.mjs` (docker-специфічні тести замінено на k8s/image-приклади).
