---
session: 9dfc7994-b7a9-48df-8524-8c221d82d608
captured: 2026-05-18T09:28:07+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9dfc7994-b7a9-48df-8524-8c221d82d608.jsonl
---

## ADR Markdown-посилання на template-файли у канонічних .mdc правилах

## Context and Problem Statement
Утиліта `findMissingMdcRefs` перевіряє, що кожен файл у `policy/*/template/` згаданий як markdown-посилання у канонічному `<id>.mdc`. Правила `text`, `js-lint` і `js-run` мали template-файли, але не містили відповідних посилань — перевірка падала для цих трьох правил.

## Considered Options
* Додати markdown-посилання безпосередньо у канонічні `.mdc` файли за зразком `security.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати markdown-посилання у канонічні `.mdc`", because це єдиний спосіб пройти перевірку `findMissingMdcRefs`, яка шукає саме посилання у `<id>.mdc`.

### Consequences
* Good, because `findMissingMdcRefs` повертає `OK` для `text`, `js-lint`, `js-run` — підтверджено запуском перевірки в transcript.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Зразок: `security.mdc` рядки 12–13 — наявні посилання вигляду `[package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)`
- Змінені файли: `npm/rules/text/text.mdc` (→ `1.28`), `npm/rules/js-lint/js-lint.mdc` (→ `1.23`), `npm/rules/js-run/js-run.mdc` (→ `1.9`)
- Перевірка: `node -e "import('./npm/scripts/utils/check-mdc-template-refs.mjs').then(...)"` — усі три повернули `OK`
- Реліз: `npm/package.json` `1.13.26 → 1.13.27`, запис у `npm/CHANGELOG.md`

---

## ADR Контекстно-залежне видалення JSON-коментарів у template.mjs

## Context and Problem Statement
`stripJsonComments` у `npm/scripts/utils/template.mjs` використовував regex `/\/\*[\s\S]*?\*\//g`, який не розрізняв коментарі від рядкових літералів. Glob-патерни типу `**/node_modules/**` містять послідовність `**/`, яка в парі з подальшим `**/` утворює `**/…/**` — regex вирізав вміст між ними. Масив `ignorePaths` із 7 елементів перетворювався на один склеєний рядок, і Rego-перевірка скаржилася на відсутність канонічних glob-ів.

## Considered Options
* Замінити regex-підхід на покрокову обробку символів із відстеженням стану рядкового літералу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Покрокова обробка символів із відстеженням string-контексту", because regex без розрізнення рядкових літералів структурно не здатен правильно обробити JSON із glob-патернами в значеннях.

### Consequences
* Good, because кількість тестів у `template.test.mjs` зросла з 25 до 26 (новий регресійний тест із `.cspell.json.snippet.json`-подібним масивом glob-ів) — підтверджено `bun test` у transcript.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл із виправленням: `npm/scripts/utils/template.mjs`, функція `stripJsonComments`
- Регресійний тест: `npm/scripts/utils/template.test.mjs` — рядок із `ignorePaths` і масивом `**/node_modules/**`, `**/vscode-extension/**` тощо
- Реліз: `npm/package.json` `1.13.27 → 1.13.28`, запис у `npm/CHANGELOG.md [1.13.28]`
