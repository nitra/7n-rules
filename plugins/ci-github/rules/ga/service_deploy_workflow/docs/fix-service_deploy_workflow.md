---
type: JS Module
title: fix-service_deploy_workflow.mjs
resource: plugins/ci-github/rules/ga/service_deploy_workflow/fix-service_deploy_workflow.mjs
docgen:
  crc: bb163530
---

## Огляд

Модуль виконує T0-автоміграцію GitHub Actions deploy-workflow до сервіс-канону `plan → lint-<domain> → deploy` (ADR 260718-0835), дзеркало `fix-service_deploy_pipeline` для `ci-azure`. Для workflow з легасі-джобою `n-rules lint --path <svc>` (без домену) додає `plan` (checkout `fetch-depth: 0` + prep + `bunx n-rules ci plan --path <svc> --github` з `id: plan` і outputs-мапінгом доменів + `any`), розкладає легасі lint на per-domain `lint-<domain>`-джоби (домени й glob-и — ті самі, що в `ci plan`), перепідключає `needs` залежних джоб і додає Skipped-толерантний `if` там, де його бракує. Наявний нетривіальний `if` не перезаписується.

`bootstrap: true` — окремий опт-ін, який `n-rules lint --fix` не викликає автоматично: для deploy-workflow БЕЗ жодної lint-джоби (rego вважає такий workflow валідним as-is — публікація без гейта може бути свідомим рішенням) створює lint-<domain>-джоби з нуля за `relevantDomains` піддерева сервісу і підключає вхідну джобу без власного `needs` до `plan` + усіх нових lint-джоб зі Skipped-толерантним `if`.

Мутації виконуються через YAML Document API — коментарі та форматування незачеплених частин файлу зберігаються. Помилки парсингу чи міграції окремого файлу не прокидаються назовні: функція повертає `false`, файл лишається без змін.

## Поведінка

- `migrateWorkflowFile(absPath, cwd, { bootstrap? })` — мігрує один deploy-workflow до канону; повертає `true`, якщо файл змінено, `false` — якщо міграція не потрібна, шлях сервісу не визначити, чи (без `bootstrap`) у workflow немає ні `plan`, ні жодного lint-кроку.
- `patterns` — T0-патерн fix-конвеєра: спрацьовує лише коли rego-концерн уже знайшов порушення у файлі (без `bootstrap`), мігрує кожен зачеплений workflow і збирає перелік змінених файлів; помилки окремих файлів не переривають обробку решти.

## Публічний API

- `migrateWorkflowFile` — переводить один deploy-workflow у канонічний формат, опційно (`bootstrap: true`) добудовуючи lint-джоби з нуля для workflow, що їх ще не мали.
- `patterns` — T0-фікс-патерн для fix-конвеєра `n-rules lint`: розпізнає порушення `service_deploy_workflow` і застосовує `migrateWorkflowFile` (без `bootstrap`) до кожного знайденого файлу.

## Гарантії поведінки

- Перехоплює помилки парсингу й міграції — не пропускає винятків назовні (fail-safe), повертає `false`.
- Не перезаписує наявний нетривіальний `if` термінальної джоби.
- `bootstrap`-логіка не активується неявно через звичайний `n-rules lint --fix` — лише за прямого виклику з `{ bootstrap: true }`.
