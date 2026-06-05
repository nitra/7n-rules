---
session: a98b9a39-809d-4e29-8612-a6afc270999b
captured: 2026-06-05T11:50:57+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/a98b9a39-809d-4e29-8612-a6afc270999b.jsonl
---

## ADR Prompt-level post-change checklist замість нового CLI-шару

## Context and Problem Statement

Агенти завершували задачі (включно з тестами/білдами), не запускаючи `npx @nitra/cursor fix changelog`, — тобто STOP-блок у `n-changelog.mdc` ігнорувався. Питання: де саме будувати «механічний» guard — у новому CLI-шарі чи у prompt-директивах?

## Considered Options

* Новий агрегатор `npx @nitra/cursor final-check` (changelog + ADR + lint + summary touched workspaces)
* Повний набір prompt-гардів у `AGENTS.md` (матриця changed→rules, 4 секції, обовʼязкова секція Validation у відповіді)
* Тонкий prompt-інваріант у `AGENTS.md` + операційний абзац у `n-changelog.mdc`

## Decision Outcome

Chosen option: "Тонкий prompt-інваріант + операційний абзац у n-changelog.mdc", because реальний механічний замок уже існує (hk pre-commit autofix + CI `check changelog`); збільшення кількості prompt-блоків порушує DRY-принцип репо (правило `n-npm-module.mdc` прямо забороняє дублювання інструкцій), а матриця changed→rules дублює glob-attachment механізм frontmatter Cursor-правил і дрейфуватиме.

### Consequences

* Good, because transcript фіксує очікувану користь: один короткий блок `## Інваріант після змін` у `npm/AGENTS.template.md` і один абзац у `changelog.mdc` — мінімальний blast radius на всі репо-споживачі `@nitra/cursor`.
* Bad, because prompt-директива не є механічним guardrail — агент технічно може її проігнорувати; правильний шлях до «механічно неможливо» — Stop-hook у Claude harness або CLI `final-check`, що transcript залишив відкритим для окремого тикету.

## More Information

Змінені файли: `npm/AGENTS.template.md`, `npm/rules/changelog/changelog.mdc` (версія `3.3 → 3.4`), дзеркала `AGENTS.md` і `.cursor/rules/n-changelog.mdc`. Change-файл: `npm/.changes/*.md` (bump `patch`). Команда синку: `node npm/bin/n-cursor.js`. Команда перевірки: `npx @nitra/cursor fix changelog` → exit `0`.

---

## ADR Вимога доказової критики користувацького інпуту в scripts.mdc

## Context and Problem Statement

Агент виконував користувацькі промти мовчки, навіть якщо підхід був неефективним або надмірно складним (показова ситуація — сесія почалася з 5-пунктового плану, реалізація якого виявилась надмірною; агент сам зробив ревізію лише після прямого питання «а вони розумні ці зміни?»). Потрібне правило, яке перетворює цей виняток на системну вимогу.

## Considered Options

* Додати поведінкову директиву до `.cursor/rules/scripts.mdc`
* Додати поведінкову директиву до `.cursor/rules/n-feedback.mdc` (правило про взаємодію/фідбек)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати до scripts.mdc", because так вказав користувач; при цьому асистент зафіксував, що семантично директива краще пасує до `n-feedback.mdc` (scripts.mdc описує лейаут `npm/rules/` і програмні перевірки), але виконав без опору після підтвердження.

### Consequences

* Good, because `scripts.mdc` має `alwaysApply: true` — директива потрапляє в контекст кожного агента без додаткових glob-умов; transcript фіксує очікувану користь: агент піддає критиці промт **доказово** (посилання `file:line`, наявні механізми, git-історія), а не субʼєктивно.
* Bad, because семантична невідповідність між темою файлу (програмні перевірки / структура правил) і behavioral-директивою підвищує ризик дрейфу: майбутній редактор `scripts.mdc` може видалити секцію як «чужорідну»; transcript це фіксує, але залишає прийнятим рішенням.

## More Information

Змінений файл: `.cursor/rules/scripts.mdc`, версія `1.13 → 1.14`. Файл локальний для цього репо (немає джерела під `npm/rules/`), синк `node npm/bin/n-cursor.js` його не перезаписує. Change-файл для цього workspace не створювався (`.cursor/rules/` exempt від changelog-перевірки).
