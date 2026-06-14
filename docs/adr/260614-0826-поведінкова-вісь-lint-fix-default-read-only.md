---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T08:26:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Дозволів на запис у `docs/adr/` не надано. Виводжу ADR-документацію як текст — можна скопіювати або зберегти вручну.

---

## ADR Поведінкова вісь lint: `fix` (default) / `--read-only`

## Context and Problem Statement
Існуючий lint-оркестратор розрізняв лише вісь scope (`quick` / `ci`(all)). Можливості запустити лінтер у режимі «тільки детект без мутацій файлів» не було — інструменти, що вміють `--fix` (oxlint, eslint, stylelint, ruff, markdownlint, oxfmt), завжди застосовували виправлення. CI потребує detect-only режиму без побічних ефектів.

## Considered Options
* Додати прапор `--read-only` до оркестратора: за замовчуванням — fix, явно — detect-only
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати прапор `--read-only` до оркестратора", because користувач визначив це як основну семантику зміни: `lint` за замовчуванням виправляє (fix-mode), `lint --read-only` лише детектує.

### Consequences
* Good, because transcript фіксує очікувану користь: `read-only` гарантує нульові мутації файлів (перевіряється `git diff` — байт-у-байт), exit 1 на будь-якій знахідці, вивід лише «що не так».
* Good, because transcript фіксує очікувану користь: `fix`-режим повертає exit 1 лише на **невиправних** залишках після автофіксу — зручний локальний workflow «виправив і поїхав».
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Прапор: `--read-only`. CI: автоматично = `--read-only`. Pre-commit хук: тільки `--read-only`. Оркестратор: `npm/scripts/lint-cli.mjs`; контракт правила: `lint(files, cwd, { readOnly })`. Інваріант read-only: LLM не викликається, жоден файл не змінюється. Спека: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`.

---

## ADR Вісь scope lint: diff від origin (default) / `--full`

## Context and Problem Statement
Попередня scope-вісь розрізняла `quick` (тільки змінені файли) і `ci`(all) (весь репо). Канонічна спека `2026-06-14-lint-rule-consolidation.md` зафіксувала нову семантику: базою є diff відносно `origin`, а `--full` перемикає на повний обхід. Вісь behavior (`fix`/`--read-only`) і вісь scope є **незалежними ортогональними осями**.

## Considered Options
* Замінити `quick`/`ci(all)` на `diff від origin` (default) / `--full`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `quick`/`ci(all)` на `diff від origin` (default) / `--full`", because канонічна спека `2026-06-14-lint-rule-consolidation.md` визначила цю семантику; користувач підтвердив її застосування до цієї спеки.

### Consequences
* Good, because transcript фіксує очікувану користь: нові шорткати стають прозорими — `n-cursor lint --read-only --full` замість `lint --ci`; `n-cursor lint --full` замість `lint --ci --fix`.
* Good, because transcript фіксує очікувану користь: check/policy concerns у diff-режимі скоуповані по змінених файлах (рішення R-4 підтверджено в transcript).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`meta.json: { lint: { scope: "per-file" | "full" } }` — канон у `2026-06-14-lint-rule-consolidation.md`. Важкі full-only concerns (jscpd, knip): викликаються лише з `--full`. Канонічна спека scope-осі: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`.

---

## ADR Поглинання `n-cursor fix` lint fix-режимом без зворотної сумісності

## Context and Problem Statement
Існували два окремі оркестратори: `lint-cli.mjs` (зовнішні тули на код) і `skills/fix/js/orchestrator.mjs` (convergence-loop + check-gate + Tier0→LLM для конформності конфігів/файлів). Тепер усі правила отримують lint-фазу, а fix-двигун стає engine lint fix-режиму. Постало питання: залишати `n-cursor fix` як deprecation-аліас чи видаляти?

## Considered Options
* Залишити `n-cursor fix` як делегувальний аліас до наступного major
* Видалити `n-cursor fix` без аліаса (breaking change)

## Decision Outcome
Chosen option: "Видалити `n-cursor fix` без аліаса (breaking change)", because користувач явно відхилив аліас: «не потрібен цей аліас»; зворотна сумісність також не вимагається (рішення R-5).

### Consequences
* Good, because transcript фіксує очікувану користь: немає legacy-коду; двигун convergence-loop (Tier0 детермінований → check-gate → Tier1+ LLM) стає єдиним fix-механізмом.
* Good, because transcript фіксує очікувану користь: concern-модель (external-tool / check / policy) уніфікує колишній розрив між двома оркестраторами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Мапа переходу: `fix` → `lint`(fix-режим); `fix-t0` → Tier0; `_fix-check --json` → `lint --read-only --json`; `fix.mjs`+`check()`+Rego policy → concerns під `lint(files, cwd, {readOnly})`. Файли до видалення: `npm/skills/fix/js/orchestrator.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/skills/fix/js/check-gate.mjs`. JSON-формат `fix --json`: зворотна сумісність не зберігається.

---

## ADR LLM-ескалація в lint fix-режимі через omlx замість хмарних

## Context and Problem Statement
Існуючий fix-двигун (`llm-worker.mjs`) використовував хмарні моделі (haiku → sonnet) через `resolveModel()` / `callLlm()` для Tier1+ ескалації автофіксу. При поглинанні fix-двигуна lint-оркестратором виникло питання щодо LLM-провайдера.

## Considered Options
* Використовувати omlx (локальний MLX-сервер) або прямі виклики як основний LLM, хмарні — лише fallback
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Використовувати omlx або прямі виклики як основний LLM", because користувач явно вказав: «замість хмарних використовуємо omlx (або прямі виклики або mimo code)».

### Consequences
* Good, because transcript фіксує очікувану користь: локальний inference не залежить від мережі й не генерує хмарні витрати під час локальної розробки.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо якості локального LLM-фіксу порівняно з хмарним.

## More Information
Інфраструктура: `npm/lib/llm.mjs` (маршрутизує `omlx/<model>` → `callOmlx`), `npm/lib/models.mjs` (`resolveModel(tier)`). Env: `N_LOCAL_MIN_MODEL=omlx/mlx-community--gemma-4-e2b-it-4bit`. Per-tool LLM-фіксери для кожного detect-only тула (knip, jscpd, cspell, trufflehog, actionlint тощо) — **окрема задача після реалізації основної спеки** (зафіксовано в transcript). Прапор `--no-llm` не додається (рішення R-3).

---

## ADR Відмова від «manual»-категорії — автофікс застосовується до всіх concerns

## Context and Problem Statement
У початковому проектуванні fix-режиму розглядалася категорія «manual» для concerns, які принципово не підлягають автоматичному виправленню (мінімум — знахідки trufflehog/security-secrets). Постало питання: чи є набір concerns, що ніколи не автофіксяться навіть у fix-режимі?

## Considered Options
* Зберегти категорію `manual` для security-concerns (trufflehog тощо) — ніколи не автофіксувати
* Автофіксувати все: Tier0 (детермінований скрипт) або Tier1+ (LLM), категорії `manual` немає

## Decision Outcome
Chosen option: "Автофіксувати все: Tier0 або Tier1+ LLM, категорії `manual` немає", because користувач дав пряму відповідь на R-1: «все фіксимо».

### Consequences
* Good, because transcript фіксує очікувану користь: єдина семантика fix-режиму без виключень; detect-only тули отримують Tier0-скрипт або LLM-фіксер.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо коректності LLM-виправлень для security-findings.

## More Information
Стратегія: якщо детермінований скрипт (Tier0) неефективний для конкретного тула — ескалація на LLM (Tier1+). Конкретні per-tool LLM-фіксери — окрема задача після реалізації основної спеки. Спека: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`.

---

## ADR Всі правила отримують lint-фазу — уніфікація точок виклику

## Context and Problem Statement
Частина правил (`n-adr`, `n-changelog`, `n-bun`, `n-feedback`, `n-vue`, `n-worktree`) не мала lint-фази. Постало питання: уніфікувати контракт лише для наявних правил чи вимагати lint від усіх?

## Considered Options
* Уніфікувати контракт `lint(files, cwd, { readOnly })` лише для правил, що вже мають lint-фазу
* Реалізувати lint для **всіх** правил, включно з тими, що досі не мали lint

## Decision Outcome
Chosen option: "Реалізувати lint для всіх правил", because користувач явно підтвердив: «для всих правил реалізуємо lint, навіть якщо до цього не було, і уніфікуємо точки виклика на оркестратор».

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу для будь-якого правила; оркестратор покриває весь репо без виключень.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо складності додавання lint до правил без попереднього lint-досвіду.

## More Information
Concern-модель уніфікує: external-tool concerns (oxlint, eslint, ruff…) і check/policy concerns (Rego, конфіги, файлова конформність) — обидва типи під `lint(files, cwd, {readOnly})`. Правила без lint-фази: `n-adr`, `n-changelog`, `n-bun`, `n-feedback`, `n-vue`, `n-worktree`. Директорія правил: `npm/rules/<id>/`.

---

## ADR Зняття заборони на паралельний запуск eslint/oxlint

## Context and Problem Statement
`CLAUDE.md` містить явну заборону паралельного запуску `bun run lint` / `lint-js` / `eslint` через перевантаження диску/CPU. Новий оркестратор оперує per-file scope-осю, де паралельні запуски по різних файлах не конкурують за ресурси.

## Considered Options
* Залишити заборону паралельного eslint/oxlint
* Зняти заборону: паралельні запуски по різних файлах допустимі

## Decision Outcome
Chosen option: "Зняти заборону: паралельні запуски по різних файлах допустимі", because користувач явно вказав: «заборону паралельного eslint/oxlint знімаємо це обмеження (бо на паралельні запуски по різним файлам це ок)».

### Consequences
* Good, because transcript фіксує очікувану користь: оркестратор може розпаралелити lint по файлах без штучних обмежень.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо поведінки при паралельних запусках по однакових файлах.

## More Information
Обмеження знімається тільки для паралельних запусків по **різних** файлах. `CLAUDE.md` потребує оновлення: прибрати або звузити відповідний абзац («Лінт і ESLint (без паралельних запусків)») після прийняття цього ADR.
