---
session: 8c95f131-5f42-46ec-9080-c6ba136055fd
captured: 2026-05-19T19:36:23+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8c95f131-5f42-46ec-9080-c6ba136055fd.jsonl
---

## ADR check changelog — ігнорування pre-existing пакунків з origin/main

## Context and Problem Statement
`check changelog` порівнює HEAD із `origin/dev` (базовий ref) і вважає пакунок "новим", якщо його `package.json` відсутній у baseRef. Директорія `demo/` вже пройшла changelog-процес і була закомічена в `origin/main` (коміти 1c575ac, 9155282, 37485f3), але ще не потрапила в `origin/dev`, тому чекер помилково вимагав повторного bump для неї.

## Considered Options
* Перевіряти наявність `package.json` лише у `baseRef` (`origin/dev`) — поточна поведінка до патча
* Додатково перевіряти наявність у `origin/main`: якщо є — пакунок pre-existing, bump не вимагається

## Decision Outcome
Chosen option: "Додатково перевіряти наявність у `origin/main`", because пакунок, що вже є в `origin/main`, пройшов changelog-процес раніше і не повинен повторно вимагати запису.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor check changelog` повертає ✅ для всіх пакунків, включаючи `demo/`, без хибних фейлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/checks/check-changelog.mjs`, рядок 100 (до патча):
```js
const isNew = !existsInRef(baseRef, pkgJsonRel)
```
Після патча (версія `1.13.56`):
```js
const existsInMain = baseRef !== 'origin/main' && existsInRef('origin/main', pkgJsonRel)
const isNew = !existsInRef(baseRef, pkgJsonRel) && !existsInMain
```
Захист `baseRef !== 'origin/main'` запобігає подвійній перевірці, коли baseRef сам є `origin/main`. Bump зафіксовано в `npm/CHANGELOG.md` як `1.13.56 — fix: check changelog — pre-existing пакунки з origin/main не вимагають повторного bump`.
