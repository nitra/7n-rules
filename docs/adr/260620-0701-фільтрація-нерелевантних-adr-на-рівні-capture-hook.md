---
session: abfb2eb3-9386-4893-bded-ada6a89c0e04
captured: 2026-06-20T07:01:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/abfb2eb3-9386-4893-bded-ada6a89c0e04.jsonl
---

## ADR Фільтрація нерелевантних ADR на рівні capture-hook

## Context and Problem Statement
При паралельній роботі в кількох проєктах в одній сесії Claude, `capture-decisions.sh` підгодовував LLM весь транскрипт. Якщо в транскрипті були `tool_use`-правки файлів з інших репозиторіїв, hook генерував ADR про рішення з чужих проєктів і записував їх у `docs/adr/` поточного проєкту.

## Considered Options
* Фільтрувати на рівні `normalize-decisions.sh` (другий етап пайплайну)
* Фільтрувати на рівні `capture-decisions.sh` (перший етап пайплайну)

## Decision Outcome
Chosen option: "Фільтрувати на рівні `capture-decisions.sh`", because на етапі capture ще живий детермінований сигнал — `CHANGED_FILES` із `tool_use.file_path`, де кожен шлях або належить `$PROJECT_ROOT`, або ні. На нормалайзі лишається тільки проза чернетки — атрибуція проєкту втрачена; також нерелевантна чернетка тоді взагалі не пишеться й не споживає бюджет нормалайзу.

### Consequences
* Good, because transcript фіксує очікувану користь: ADR про рішення з чужих репо більше не потрапляють до `docs/adr/` поточного проєкту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано два шари захисту в `npm/.claude-template/hooks/capture-decisions.sh` (синхронізовано до `.claude/hooks/capture-decisions.sh`):
1. **Детермінований cross-project gate**: якщо в сесії були правки, але жодна не під `$PROJECT_ROOT` → ADR не пишеться. Вимикається `ADR_CAPTURE_SKIP_CROSS_PROJECT=0`.
2. **Scope у промпті**: для змішаних сесій (є правки і тут, і в інших репо) — до промпту додається `CURRENT PROJECT ROOT` і вказівка документувати лише рішення в межах цього кореня.
Helper `has_in_project_change` додано до `npm/.claude-template/hooks/lib/tooling-only.sh` за тим самим патерном, що й наявний `is_tooling_only_change`.
Тест: `npm/rules/adr/js/tests/capture-decisions-cross-project.test.mjs` (4 кейси, 36/36 тестів правила `adr` зелені).

---

## ADR Ретроактивне виявлення нерелевантних ADR — детермінований контентний скан

## Context and Problem Statement
Після впровадження capture-фільтра постало питання: чи можна очистити вже накопичені 674 ADR у `docs/adr/`, серед яких потенційно є записані з паралельних сесій нерелевантні рішення. Транскрипт-based перевірка (через `has_in_project_change`) показала 0 кандидатів — бо 222 чернетки мають вже видалений файл сесії, а 310 нормалізованих ADR взагалі не містять `transcript:`.

## Considered Options
* Детермінований скан по файлових шляхах, згаданих у тексті ADR
* LLM-суддя: для кожного ADR запитувати модель, чи стосується він поточного проєкту

## Decision Outcome
Chosen option: "Детермінований скан по файлових шляхах", because дешевше, не потребує LLM-викликів для 674 файлів, і достатньо точне для першого проходу; LLM-варіант лишається резервним.

### Consequences
* Good, because transcript фіксує очікувану користь: скан виявив 28 кандидатів із 674 без жодного LLM-виклику; кожен кандидат має підтверджений список «чужих» шляхів для ручного перегляду.
* Bad, because ADR без явних файлових шляхів у тексті (6 таких) скан класифікує як `no-paths → keep` — вони не перевіряються детермінованим методом.

## More Information
Скан реалізовано в `/tmp/adr-relevance-scan.mjs`. Логіка кандидата: витягнути токени з розширенням файлу з тексту ADR; якщо ≥1 такий токен знайдено, але жоден не існує ані в поточному `git ls-files`, ані в повній `git log --all` (щоб не видаляти легітимні ADR про видалені файли) → кандидат. Результат dry-run: 640 релевантних, 28 кандидатів, 6 без шляхів. Видалення — після ручного перегляду кандидатів.
