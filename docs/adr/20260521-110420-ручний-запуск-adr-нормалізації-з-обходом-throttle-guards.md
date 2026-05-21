---
session: 80abf597-8729-4100-8d58-bfd055cc4aa2
captured: 2026-05-21T11:04:20+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/80abf597-8729-4100-8d58-bfd055cc4aa2.jsonl
---

## ADR Ручний запуск ADR-нормалізації з обходом throttle-guards

## Context and Problem Statement
Автоматичний hook `.claude/hooks/normalize-decisions.sh` має два throttle-guard: `ADR_NORMALIZE_THRESHOLD` (мінімальна кількість чернеток для старту) і `ADR_NORMALIZE_MIN_INTERVAL_HOURS` (cooldown між прогонами). При ручному запуску `/n-adr-normalize` обидва значення виставляються у `0`, щоб оператор міг ініціювати прогон у будь-який момент незалежно від накопичених чернеток і минулого часу.

## Considered Options
* Запустити скрипт напряму без зміни env-змінних (спрацює throttle, якщо ≤threshold або cooldown не минув)
* Обійти throttle через `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0` перед викликом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Обійти throttle через `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0`", because скіл `n-adr-normalize` призначений саме для форсованого ручного запуску — операторові потрібен повний контроль без очікування автоматичного тригера.

### Consequences
* Good, because transcript фіксує очікувану користь: два послідовних батчі запустились успішно (лог містить `drafts found: 74` і `drafts found: 72`), тоді як без обходу скрипт видавав `skip: only N s since last attempt`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Виклики: `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 bash .claude/hooks/normalize-decisions.sh`
- Dry-run перед реальним прогоном: `ADR_NORMALIZE_DRY=1` — лог виводить `DRY RUN — would apply 10 operations`
- Скрипт: `.claude/hooks/normalize-decisions.sh`; лог: `.claude/hooks/normalize-decisions.log`
- Batch size зафіксовано у логу: `batch size: 10`; модель: `claude CLI (model: sonnet)`

---

## ADR Пост-батч workflow: залишати результат для рев'ю без авто-коміту

## Context and Problem Statement
Після завершення реального батчу нормалізації (6 rewrite + 1 merge-into у `docs/adr/`) постало питання, що робити з unstaged змінами: комітити відразу чи залишити для перегляду. Паралельно з нормалізованими файлами в `docs/adr/` з'явились 4 нові чернетки (`20260521-…`), захоплені hook-ом під час сесії — `git add docs/adr/` їх теж включив би в коміт.

## Considered Options
* `git add docs/adr/ && git commit -m "adr: normalize batch"` — закомітити одразу (включно з новими чернетками)
* Лишити для рев'ю — не комітити, переглянути git diff вручну перед стейджингом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Лишити для рев'ю", because авто-коміт включив би нові чернетки `20260521-…`, які не пройшли нормалізацію, і змішав би два логічних кроки в один коміт.

### Consequences
* Good, because transcript фіксує очікувану користь: оператор може перевірити якість MADR-файлів і виключити нові чернетки зі стейджингу перед комітом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Незакомічені файли після батчу: 6 нових ADR у `docs/adr/` + 1 змінений `inline-template-links-у-mdc-при-sync.md` (merge-into, +11 рядків) + 4 нові чернетки `20260521-…`
- Кількість чернеток, що залишились після батчу: 71 (`session:` у frontmatter)
- Наступний батч запущено відразу після рішення про рев'ю (фоновий процес PID 72977)
