---
session: ea881c04-dcf0-4753-a405-2366550a0911
captured: 2026-05-21T13:26:58+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/ea881c04-dcf0-4753-a405-2366550a0911.jsonl
---

## ADR `check` без аргументів читає `.cursor/rules/` напряму

## Context and Problem Statement
Коли `npx @nitra/cursor check` запускається без аргументів, виникло питання: який файл є джерелом правил — `.cursor/rules/` чи похідні `agents.md`/`claude.md`. Потрібно визначити однозначну поведінку, щоб уникнути розбіжностей між джерелом і дериватами.

## Considered Options
* Читати `.cursor/rules/` напряму
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Читати `.cursor/rules/` напряму", because `agents.md` і `claude.md` є похідними файлами, згенерованими з `.cursor/rules/`, тому `check` читає джерело, а не деривати — незалежно від того, чи передано аргументи.

### Consequences
* Good, because поведінка `check` стала однозначною: завжди читає `.cursor/rules/`, незалежно від наявності аргументів.
* Bad, because якщо правило додано тільки до `agents.md` і не синхронізовано у `.cursor/rules/`, `check` його не знайде, що може дезорієнтувати розробника.

## More Information
Нормалізовані файли: `docs/adr/check-без-аргументів-читає-cursor-rules-не-agents-md.md`, `docs/adr/check-без-аргументів-читає-cursor-rules-а-не-agents-md.md`. Джерело: drafts `20260521-131937-...` та `20260521-131946-...`, оброблені скриптом `.claude/hooks/normalize-decisions.sh`.

---

## ADR Генерація `agents.md` та `claude.md` читає `.cursor/rules/` без фільтрації

## Context and Problem Statement
При генерації файлів `agents.md` і `claude.md` потрібно визначити, чи фільтрувати правила з `.cursor/rules/` під час читання, чи включати їх усі без виключень.

## Considered Options
* Читати `.cursor/rules/` без фільтрації
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Читати `.cursor/rules/` без фільтрації", because transcript фіксує, що `agents.md` / `claude.md` є повним результатом генерації з `.cursor/rules/` — саме тому `check` може читати джерело напряму й отримувати ту саму множину правил.

### Consequences
* Good, because transcript фіксує очікувану користь: `check` і генератор працюють з одним і тим самим набором правил, без розбіжностей через фільтрацію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нормалізований файл: `docs/adr/генерація-agents-md-та-claude-md-читає-cursor-без-фільтрації.md`. Джерело: draft `20260521-131653-...`, оброблений скриптом `.claude/hooks/normalize-decisions.sh`. Зв'язок із попереднім рішенням: те, що генерація не фільтрує, обґрунтовує вибір `.cursor/rules/` як єдиного джерела для `check`.
