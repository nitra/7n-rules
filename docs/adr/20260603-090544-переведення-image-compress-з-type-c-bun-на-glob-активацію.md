---
session: 2b3e2d11-3e3a-4556-ad25-e5787c1d45f0
captured: 2026-06-03T09:05:44+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/2b3e2d11-3e3a-4556-ad25-e5787c1d45f0/2b3e2d11-3e3a-4556-ad25-e5787c1d45f0.jsonl
---

## ADR Переведення image-compress з Type C (bun) на glob-активацію

## Context and Problem Statement
Правило `image-compress` мало `{ "auto": ["bun"] }` у `meta.json`, тобто автододавалось у `.n-cursor.json` кожного bun-репо як Type C залежність — навіть якщо в проєкті жодного растру чи SVG немає.

## Considered Options
* Залишити Type C залежність від `bun`
* Перейти на glob-активацію за наявністю `**/*.{png,jpg,jpeg,gif,svg}`

## Decision Outcome
Chosen option: "Перейти на glob-активацію", because завдання явно вимагає додавати правило лише коли в репо реально є файли `**/*.{png,jpg,jpeg,gif,svg}`; значення glob синхронізується з context-glob у `image-compress.mdc` (де цей патерн вже стояв як джерело істини).

### Consequences
* Good, because у bun-проєктах без растрів/SVG `image-compress` більше не зʼявляється в `.n-cursor.json` автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/image-compress/meta.json` — змінено з `{ "auto": ["bun"] }` на `{ "auto": { "glob": "**/*.{png,jpg,jpeg,gif,svg}" } }`.
- `npm/rules/image-avif/meta.json` — єдиний інший `meta.json` із залежністю від `image-compress`; залишено без змін, бо `image-avif` потребує растрів за визначенням і ланцюг `vue + image-compress → image-avif` залишається коректним.
- Тести `npm/scripts/tests/auto-rules.test.mjs`: прибрано тест co-activation `image-compress + bun`; додано кейси «репо із зображенням → detected», «bun-репо без зображень → не detected», «зображення без vue → лише `image-compress`».
- Change-файл `npm/.changes/1780466581847-9b5f19.md` (`bump: minor`, `section: Changed`).

---

## ADR Підтримка brace-альтернатив у globToRegex

## Context and Problem Statement
Після зміни `meta.json` на brace-форму `**/*.{png,jpg,jpeg,gif,svg}` виявилось, що `globToRegex` у `npm/rules/npm-module/js/package_structure.mjs` екранує `{`, `}`, `,` як regex-літерали, тому glob-матчинг фактично ніколи не спрацьовував для brace-патернів.

## Considered Options
* Зберігати масив окремих патернів у `meta.json` (одна бранча `if/else` без brace)
* Додати підтримку brace-альтернатив `{a,b,c}` безпосередньо до `globToRegex`

## Decision Outcome
Chosen option: "Додати підтримку brace-альтернатив до `globToRegex`", because завдання вимагає дослівної синхронізації значення у `meta.json` із context-glob у `.mdc`, де стоїть brace-форма; зміна безпечна — наявні негативні `files`-патерни braces не містять.

### Consequences
* Good, because transcript фіксує очікувану користь: brace-форма `**/*.{png,jpg,jpeg,gif,svg}` у `meta.json` тепер матчить коректно; весь інший glob-матчинг (наприклад, негативні `files`-патерни npm-module) залишається незмінним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/npm-module/js/package_structure.mjs` — у `globToRegex` реалізовано обробку `{` (відкриває `(?:`), `}` (закриває `)`) та `,` всередині brace-блоку (додає `|`); рефакторено з `if/else if` на `switch` із фігурними дужками у `case` через вимоги oxc-лінтера.
- `npm/rules/npm-module/js/tests/pure-helpers.test.mjs` — додано тест brace-розкриття: `globToRegex('**/*.{png,jpg,svg}')`.
- Попередня реалізація `globToRegex` навмисно уникала braces і використовувала масив патернів як обхідний шлях, але цей підхід не міг задовольнити вимогу синхронізації з `.mdc`.
- `bunx vitest run` — 2303 passed, 2 skipped після змін.
