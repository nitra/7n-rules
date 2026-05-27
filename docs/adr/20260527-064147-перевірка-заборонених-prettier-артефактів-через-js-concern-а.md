---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-27T06:41:47+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

## ADR Перевірка заборонених Prettier-артефактів через JS concern, а не розширення target.json

## Context and Problem Statement
Правило `text.mdc` забороняє Prettier-конфіги (`.prettierignore`, `.prettierrc*`, `prettier.config.*`) і виклики prettier у `package.json#scripts`, але `npx @nitra/cursor fix text` не ловив ці порушення програматично. Потрібно було обрати між розширенням декларативного механізму `target.json` новою формою `forbiddenSingle`/`forbiddenGlob` і додаванням JS concern.

## Considered Options
* Додати JS concern `rules/text/js/forbidden-prettier.mjs` (використовує існуючий контракт `check()` + `existsSync`)
* Розширити `target.json` schema і runner новою формою `files.forbiddenSingle` / `files.forbiddenGlob`

## Decision Outcome
Chosen option: "Додати JS concern `rules/text/js/forbidden-prettier.mjs`", because runner вже автоматично виявляє `rules/<id>/js/*.mjs`-файли, а новий declarative механізм вимагав би змін схеми, runner-а і тестів runner-а — більша зміна поза scope задачі.

### Consequences
* Good, because transcript фіксує очікувану користь: новий concern автоматично підхоплюється runner-ом без змін у `run-rule.mjs` чи `target.json` schema.
* Bad, because список заборонених файлів живе в `forbidden-prettier.mjs`, а не в декларативному `target.json` — якщо в майбутньому з'явиться `forbiddenGlob`, цей concern треба буде мігрувати.

## More Information
* Новий файл: `npm/rules/text/js/forbidden-prettier.mjs` — перевіряє 20 файлів через `existsSync`
* Тести: `npm/rules/text/js/tests/forbidden-prettier.test.mjs` — 5 vitest-кейсів
* Аналог-приклад: `npm/rules/php/js/tooling.mjs` (FS existence check)
* Видалено дублюючий inline-список у `npm/rules/text/js/formatting.mjs`

---

## ADR Token-based Rego regex для заборони prettier у package.json#scripts

## Context and Problem Statement
`package.json#scripts.*` міг містити виклики `prettier` (наприклад `bunx prettier --write .`), але наявний Rego в `text/policy/package_json/package_json.rego` перевіряв тільки `dependencies`/`devDependencies`. Потрібно було обрати стратегію матчингу: substring `contains(cmd, "prettier")` або токен-based regex.

## Considered Options
* Проста substring перевірка: `contains(cmd, "prettier")`
* Token-based regex: `regex.match("(^|[\\s/\"'])prettier($|[\\s'\"@])", cmd)`

## Decision Outcome
Chosen option: "Token-based regex", because потрібно уникнути false-positive на підрядки типу `not-prettier` або `prettier-ignore-comment` всередині інших ідентифікаторів; regex ловить `bunx prettier`, `npx prettier`, `./node_modules/.bin/prettier`, `prettier --write`.

### Consequences
* Good, because transcript фіксує очікувану користь: 5 Rego-тестів (bunx/npx/bare/path-prettier deny, allow при `oxfmt` і при `not-prettier` substring) пройшли `conftest verify` — 13/13 passed.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Змінений файл: `npm/rules/text/policy/package_json/package_json.rego` — новий `deny` блок із helper `script_invokes_prettier/1`
* Тести: `npm/rules/text/policy/package_json/package_json_test.rego`
* Перевірено: `opa check --strict`, `regal lint` — no violations

---

## ADR opts.cwd замість process.chdir у тестах coverage

## Context and Problem Statement
Попередня спроба генерації тестів для `rules/test/coverage/coverage.mjs` (через agent) використала `process.chdir(tmp)` у setup-хелпері. Під час паралельного запуску vitest це спричинило race condition з іншими test-файлами (зокрема `rules/changelog/js/tests/consistency/tests/check.test.mjs`), що призвело до непрошеного `git commit` у реальному репозиторії.

## Considered Options
* Використовувати `process.chdir(tmp)` у `beforeEach`/`afterEach`
* Передавати `opts.cwd` безпосередньо в `runCoverageSteps` (функція вже підтримує цей параметр)

## Decision Outcome
Chosen option: "Передавати `opts.cwd` безпосередньо в `runCoverageSteps`", because `coverage.mjs` вже приймає `opts.cwd ?? process.cwd()`, тому `process.chdir` не потрібен; усунення глобальної мутації процесу дозволяє безпечно запускати тести паралельно.

### Consequences
* Good, because transcript фіксує очікувану користь: повний suite 101/101 test files passed без race condition після заміни.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Змінений файл: `npm/rules/test/coverage/tests/coverage.test.mjs` — переписаний з нуля, 18 тестів, без `process.chdir`
* Root cause виявлено: `changelog/js/tests/consistency` виконує `git commit -m init` у tmpdir паралельно з іншими тестами; коли `process.chdir` переміщував CWD воркера, git-команди потрапляли у реальний репозиторій
* Відновлення: `git reset --mixed HEAD~1` + `git restore` для трьох пошкоджених файлів
