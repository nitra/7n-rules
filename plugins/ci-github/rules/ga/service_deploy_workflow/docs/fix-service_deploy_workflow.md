---
type: JS Module
title: fix-service_deploy_workflow.mjs
resource: plugins/ci-github/rules/ga/service_deploy_workflow/fix-service_deploy_workflow.mjs
docgen:
  crc: 9582591b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл виконує T0-автоміграцію `.github/workflows/deploy-*.yml` до сервісного канону для `service_deploy_workflow`, як у `fix-service_deploy_pipeline` для `ci-azure`: детерміновано переписує лише workflow, що не відповідають формі `plan → lint-<domain> → deploy`. Додає job `plan` із `fetch-depth: 0`, prep і `bunx n-rules ci plan --path <svc> --github`, створює `id: plan` та outputs-мапінг доменів і `any`, щоб `needs.plan.outputs.*` були доступні в runtime. Legacy job із `n-rules lint --path <svc>` без домену замінює на per-domain jobs `lint-<domain>` за тими самими glob-ами, що й `ci plan` через `computeActiveDomains/domainKey`; domain-style lint-джоби отримують wiring із `needs: plan`, умовами по outputs, `--no-fix`, `fetch-depth: 0` і prep. `needs` інших jobs перешивається з legacy-імені, а jobs із прямими `needs` на умовні lint-джоби без власного `if` отримують Skipped-толерантний канон `!cancelled` + `!contains`. Мутації виконуються через YAML Document API, тому `jobs` у GA лишається map, а коментарі та форматування незачеплених частин зберігаються; наявний нетривіальний `if` не перезаписується. Публічні функції: `migrateWorkflowFile`, `patterns`. Fail-safe: помилки не прокидаються назовні, а за окремих збоїв повертається порожнє значення.

## Поведінка

- `migrateWorkflowFile` — мігрує один GitHub Actions deploy-workflow до сервісного канону: додає `plan`, розкладає legacy lint на per-domain jobs, перешиває `needs` і лишає файл без змін, якщо міграція не потрібна або не вдалася.
- `patterns` — описує T0-патерн fix-конвеєра: запускає міграцію лише для workflow з порушенням і повертає перелік змінених файлів та коротке повідомлення без винесення помилок назовні.

## Публічний API

- migrateWorkflowFile — переводить один deploy-workflow у канонічний формат і повідомляє, чи були зміни
- patterns — задає шаблони для розпізнавання та обробки workflow-файлів

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
