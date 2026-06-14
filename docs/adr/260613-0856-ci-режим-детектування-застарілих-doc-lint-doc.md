---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-13T08:56:41+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

## ADR CI-режим детектування застарілих doc (lint-doc)

## Context and Problem Statement
У PR `claude/quirky-lederberg-4306d8` додається GA workflow `lint-doc.yml` і `lint-doc` підключається до кореневого `lint`-ланцюжку. Необхідно вирішити, які порушення призводять до `exit 1` у CI: тільки відсутні доки (`missing`) чи також доки з `crc-mismatch` (джерело змінилося, дока не перегенерована).

## Considered Options
* Варіант 1 — повний stale-детект: `stale = missing ∪ crc-mismatch`
* Варіант 2 — `--missing-only`: CI реагує лише на відсутність доки, `crc-mismatch` ігнорується

## Decision Outcome
Chosen option: "Варіант 1 — повний stale-детект", because `--missing-only` лишає головну діру відкритою — доки тихо відстають від коду без реакції CI; повний детект гарантує, що будь-яка зміна джерела без перегенерації доки ловиться в PR.

### Consequences
* Good, because transcript фіксує очікувану користь: «будь-яка зміна коду без перегенерації доки ловиться в PR, дока ніколи мовчки не «протухає»».
* Bad, because кожна правка джерела вимагає локального запуску `fix-doc` і комміту оновленої доки перед push; передумова — до ввімкнення CI треба встановити зелений baseline через повний `fix-doc`.

## More Information
- Spec: `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`, секція 6, п.4
- `--missing-only` лишається як опція команди CLI, але не є режимом CI
- Пов'язаний ADR: `20260516-rules-fix-lint-policy-structure`

---

## ADR Розміщення git-diff-логіки lint-doc: CLI-режим `--since <ref>`

## Context and Problem Statement
GA workflow і локальні агенти мають перевіряти лише змінені файли (не весь проєкт). Питання — де розмістити логіку обчислення git-diff і фільтрації шляхів: у YAML workflow чи в CLI-команді `lint-doc`.

## Considered Options
* Новий CLI-режим `lint-doc --since <ref>` (diff-логіка в CLI)
* Рахувати diff у YAML і передавати явний список шляхів `lint-doc <paths…>`

## Decision Outcome
Chosen option: "Новий CLI-режим `lint-doc --since <ref>`", because він забезпечує єдиний механізм для GA workflow і локальних агентів (`lint-doc --since origin`), а вся git-логіка зосереджена в одному тестованому місці CLI — не розмазана по YAML.

### Consequences
* Good, because GA YAML лишається тонким: обчислив `BASE` → `bun run lint-doc --since $BASE`; локальний агент викликає `lint-doc --since origin` без знання конкретних шляхів.
* Bad, because потребує розширення CLI-специфікації та тестів для `--since` поряд із наявними `--git`/`--missing-only`.

## More Information
- При порожньому/відсутньому `<ref>` команда має падати на повний скан
- PR-подія: `BASE = git diff --name-only --merge-base origin/${{ github.base_ref }}`
- Push у `main`: `BASE` — SHA останнього успішного run через `gh run list --workflow lint-doc.yml --status success --limit 1 --json headSha`; перевагу надано над `nrwl/nx-set-shas` для уникнення сторонніх actions
- Потребує `fetch-depth: 0` у checkout; squash-merge у `main` рве ancestry — `gh`-запит по успішних ранах обходить це

---

## ADR Дефолтний режим `lint-doc`: інкрементальний (vs origin), повний скан через `--full`

## Context and Problem Statement
Після введення `--since <ref>` виникло питання: який режим є дефолтним при запуску `lint-doc` без аргументів — повний скан чи інкрементальний diff. Ключова вимога — щоб дефолт був зручним для локальних агентів, які змінюють файли й хочуть швидко перевірити тільки свої правки.

## Considered Options
* Дефолт — інкрементальний diff проти `origin`; повний скан через окремий прапор
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дефолт — інкрементальний diff проти `origin`; повний скан через `--full`", because користувач явно визначив: «`lint-doc` за замовчуванням тільки по різниці з `origin`, а `lint-doc --full` це повний прогон».

### Consequences
* Good, because локальний агент після будь-якої правки викликає просто `lint-doc` — отримує перевірку лише своїх змін без зайвого навантаження.
* Good, because GA workflow та агенти використовують той самий дефолт — жодних додаткових прапорів для стандартного use-case.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Дефолтний ref для diff: `origin` (implicit `origin/HEAD` або `@{upstream}`)
- `lint-doc --full` — єдиний спосіб запустити повний скан; використовується локально для встановлення baseline перед першим увімкненням CI
- Попередня дискусія фіксувала резолв: явний `<ref>` → `@{upstream}` → `origin/HEAD`; дефолт тепер закріплює `origin` як канонічний fallback
