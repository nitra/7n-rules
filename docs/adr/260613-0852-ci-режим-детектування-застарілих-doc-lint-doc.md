---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-13T08:52:43+03:00
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

## ADR Повний скан lint-doc тільки локально

## Context and Problem Statement
Після введення `lint-doc --since <ref>` для GA треба визначити, де і коли виконується повний скан усіх файлів (без фільтрації за diff) — у GA по schedule/push у `main` чи виключно локально.

## Considered Options
* Повний скан тільки локально
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Повний скан тільки локально", because користувач явно зазначив: «повний скан буде відбуватись тільки локально»; локальний агент при зміні файлів викликає `lint-doc --since origin` (або аналогічний ref) для скопованого детекту.

### Consequences
* Good, because GA workflow швидший — обробляє тільки delta від baseline.
* Neutral, because transcript не містить підтвердження наслідку щодо safety-net у GA (schedule або push у `main`): асистент згадував його як рекомендацію, проте явного рішення зафіксовано не було.

## More Information
- Локальний агент порівнює проти `origin` або іншого зручного ref — конкретний ref у transcript не зафіксований
- Передумова для GA: baseline встановлюється локальним повним скані перед увімкненням workflow
- Додаткової інформації в transcript не зафіксовано щодо конкретного ref для локального порівняння
