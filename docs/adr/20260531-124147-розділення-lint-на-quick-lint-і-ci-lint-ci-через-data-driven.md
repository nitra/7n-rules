---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T12:41:47+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Розділення lint на quick (lint) і ci (lint-ci) через data-driven meta.json

## Context and Problem Statement
Поточний кореневий скрипт `lint` = хардкодований ланцюг із 6 під-лінтів (`lint-ga && lint-js && lint-rego && lint-security && lint-style && lint-text && oxfmt .`). Він завжди обходить все репо, що робить його занадто повільним для перевірки поточних змін агентом/розробником. Потрібна швидка версія (лише змінені файли) і повна версія (для CI).

## Considered Options
* **A**: нові npm-скрипти у кореневому `package.json` (хардкод-ланцюги quick і ci)
* **B**: генерація скриптів під час sync на основі meta
* **F1 (обрано)**: CLI-оркестратор у пакеті `@nitra/cursor` читає `rules/*/meta.json` і будує набір кроків динамічно; кореневий `package.json` делегує через `n-cursor lint` / `n-cursor lint-ci`

## Decision Outcome
Chosen option: "F1 — CLI-оркестратор, data-driven", because це єдиний підхід, де атрибут `meta.json` реально керує набором кроків (як `auto-rules` після Spec B); A/B або зберігають хардкод, або не підтримують логіку «по змінених».

### Consequences
* Good, because transcript фіксує очікувану користь: узгодженість з рештою системи (auto-rules data-driven, worktree CLI); хардкод-ланцюг у `package.json` зникає.
* Bad, because transcript не містить підтверджених негативних наслідків. (Більша кількість нового коду в пакеті — нотатка зафіксована, негативним не названо.)

## More Information
- Конвенція назв: `lint` = швидкий, `lint-ci` = повний (user-запропонована, прийнята без альтернатив).
- Нові скрипти у кореневому `package.json`: `"lint": "n-cursor lint"`, `"lint-ci": "n-cursor lint-ci"`.
- Правила з `meta.json`: поле `lint: "quick"|"ci"`; quick⊆ci (quick-кроки входять в обидва набори).

---

## ADR Поле `lint` у `meta.json` правила (E1) та склад quick-набору (D3, H1)

## Context and Problem Statement
Для data-driven оркестрації lint-кроків треба декларувати в `rules/*/meta.json`, який крок до якої фази належить. Проблема: правило `js-lint` є композитом — `oxlint`/`eslint` можуть лінтити підмножину файлів, а `jscpd`/`knip` вимагають увесь проєкт.

## Considered Options
* **D1**: поле `lint` на рівні правила (грубо) — правило цілком `quick` або `ci`
* **D2**: поле `lint` на рівні інструмента/кроку всередині правила
* **D3 (обрано)**: поле `lint` на рівні правила + явне розщеплення `js-lint` на два кроки: `js-lint` (quick: oxlint+eslint) і `js-lint-ci` (ci: jscpd+knip)
* **E2**: `lint: { phase, scope }` — окремі вісі фаза і область охоплення
* **E3**: булеві прапорці `lintQuick`/`lintCi`
* **E1 (обрано)**: одне поле `lint: "quick"|"ci"` з семантикою quick⊆ci

## Decision Outcome
Chosen option: "D3 + E1", because більшість правил однорідні й лягають у простий атрибут (D1 достатньо); `js-lint` — єдиний реальний композит, тому одне явне розщеплення дешевше за загальне ускладнення (D2/E2/E3). E1 з одним полем і виведеним scope уникає зайвих вісей (YAGNI).

### Consequences
* Good, because transcript фіксує очікувану користь: мінімальна схема (одне поле), узгоджена з наявним `meta.json`; scope (changed/all) виводиться з фази, не дублюється.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/js-lint/meta.json` отримає `"lint": "quick"` (oxlint+eslint-крок); новий крок `js-lint-ci` (`jscpd+knip`) — `"lint": "ci"`.
- Правила `security` (trufflehog), `rego`, `ga`, `text` — `"lint": "ci"` (рішення H1 нижче).
- Правила `style-lint` (stylelint приймає glob) — `"lint": "quick"`.

---

## ADR База файлів для quick-лінту (G3) та виключення CLI-кроків із quick (H1)

## Context and Problem Statement
CLI-оркестратор `n-cursor lint` (quick) має визначати, які файли передавати інструментам. Треба вибрати базу порівняння (`git diff`) і вирішити, чи розширювати CLI-лінтери (`lint-ga`, `lint-rego`, `lint-text`) підтримкою списку файлів для quick-режиму.

## Considered Options
* **G1**: змінені файли відносно HEAD (без untracked)
* **G2**: всі зміни гілки відносно merge-base з `main`
* **G3 (обрано)**: working-tree зміни відносно HEAD включно з untracked файлами
* **H1 (обрано)**: `lint-ga`, `lint-rego`, `lint-text` лишаються лише у `ci`-наборі (не отримують `--files` аргумент)
* **H2**: розширити ці CLI-команди аргументом `--files` для quick-режиму

## Decision Outcome
Chosen option: "G3 + H1", because G3 покриває сценарій «агент щойно створив/змінив файли перед комітом» — нові (untracked) файли теж мають бути залінтовані; H1 обрано за принципом YAGNI — ga/rego/text рідко змінюються в одному PR і є дешевими, розширення CLI для v1 надлишкове.

### Consequences
* Good, because transcript фіксує очікувану користь: G3 не пропускає нових файлів; H1 зменшує обсяг реалізації v1.
* Bad, because H1: у quick-режимі ga/rego/text-файли не перевіряються — якщо агент змінює workflow або rego, треба запускати `lint-ci`. Transcript фіксує цей трейдоф як свідомий.

## More Information
- Команди, що приймають підмножину файлів (підтримують quick): `oxlint <files>`, `eslint <files>`, `stylelint <glob>`, `oxfmt <files>`.
- Команди, що потребують увесь проєкт (завжди ci): `jscpd`, `knip`, `trufflehog`, `n-cursor lint-ga`, `n-cursor lint-rego`, `n-cursor lint-text`.
- H2 (підтримка `--files` у CLI-кроках) — явно відкладено для наступних версій.
