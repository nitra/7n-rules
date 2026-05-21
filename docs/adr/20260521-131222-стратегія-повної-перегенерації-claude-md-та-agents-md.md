---
session: b0662984-b598-44eb-a8ed-5cb126e87153
captured: 2026-05-21T13:12:22+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/b0662984-b598-44eb-a8ed-5cb126e87153/b0662984-b598-44eb-a8ed-5cb126e87153.jsonl
---

## ADR Стратегія повної перегенерації `CLAUDE.md` та `AGENTS.md`

## Context and Problem Statement
`npx @nitra/cursor` синхронізує правила, скіли й команди. Постало питання: чи зберігаються ручні правки безпосередньо в `CLAUDE.md` / `AGENTS.md` між запусками CLI.

## Considered Options
* Повна перегенерація файлів при кожному синку (поточна поведінка)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Повна перегенерація файлів при кожному синку", because `CLAUDE.md` містить попередження про автогенерацію, а статичний контент для всіх проєктів зберігається в `npm/AGENTS.template.md` пакета `@nitra/cursor`.

### Consequences
* Good, because transcript фіксує очікувану користь: індекс завжди відповідає поточному стану `.cursor/rules/` та `.cursor/skills/` без ручного обслуговування.
* Bad, because будь-які ручні правки в `CLAUDE.md` і `AGENTS.md` зникають при наступному `npx @nitra/cursor`.

## More Information
Файли задіяні: `npm/bin/n-cursor.js`, `npm/AGENTS.template.md`. Статичні інструкції слід вносити в `npm/AGENTS.template.md` у пакеті, а не в генеровані файли споживача.

---

## ADR Конвенція префікса `n-` для розмежування керованих і користувацьких артефактів

## Context and Problem Statement
CLI `@nitra/cursor` синхронізує правила й скіли з пакета до `.cursor/rules/` і `.cursor/skills/` проєкту-споживача. Потрібно розрізняти, які файли/каталоги є власністю CLI, а які — власністю користувача.

## Considered Options
* Префікс `n-` позначає CLI-керовані артефакти; все інше — користувацьке
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Префікс `n-` позначає CLI-керовані артефакти", because це дозволяє orphan-очищенню видаляти лише зайві `n-*.mdc` і `n-*/` каталоги, не чіпаючи файли без цього префікса.

### Consequences
* Good, because transcript фіксує очікувану користь: ручні правила (`conftest.mdc`, `dev-dep.mdc`, `scripts.mdc`) і скіли (`mdc-check/`) зберігаються й потрапляють у згенерований індекс.
* Bad, because ручні зміни всередині `n-*.mdc` або `n-*/SKILL.md` перезаписуються при синку — канон зберігається лише в `npm/rules/` і `npm/skills/` пакета.

## More Information
Логіка очищення й синку зосереджена в `npm/bin/n-cursor.js`. Конфігурація списку керованих правил і скілів — у `.n-cursor.json` споживача (поля `rules`, `skills`). Сканування всіх `.mdc` для індексу реалізоване у функції `listProjectRulesMdcFiles()` (`npm/bin/n-cursor.js:489–496`) — фільтрації за префіксом там немає, тому користувацькі правила без `n-` також з'являються в `AGENTS.md` / `CLAUDE.md`.
