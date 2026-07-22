---
type: JS Module
title: fix-service_deploy_pipeline.mjs
resource: plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline/fix-service_deploy_pipeline.mjs
docgen:
  crc: bf24b078
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  issues: anchor-miss:https://bun.sh/install,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Фіксер для T0-автоміграції легасі service-pipeline-ів до канону з ADR 260718-0835: він переписує `.azurepipelines/**.yml` з `trigger.paths.include`, що не відповідають формі plan → lint_<domain> → deploy і порушують rego-концерн `service_deploy_pipeline`. Через зміну семантики `n-rules lint --path` у `@7n/rules 1.17` він одразу переводить pipeline у новий канон замість ручної міграції 18 efes-пайплайнів.

Під час перепису додається `plan` як prep + `bunx n-rules ci plan --path <svc> --azure` (`ci plan --path <svc> --azure`), legacy job з `n-rules lint --path <svc>` замінюється на `lint_<key>` за доменами, визначеними через `computeActiveDomains/domainKey`, а wiring для lint-джоб додає `dependsOn: plan`, condition по outputs, `--no-fix` і `fetchDepth: 0`. Залежності інших job-ів перешиваються з legacy-імені на нові lint-джоби, а job-и з прямими deps на conditional lint-джоби без власного condition отримують Skipped-толерантний канон (`not` + `in`).

Власний `condition` не перезаписується, якщо він нетривіальний, а `- template:` розкладка не мігрується, бо фіксер працює лише з розгорнутими job-ами. `patterns` звужує скоуп до pipeline-файлів, чий `trigger.paths.include` відповідає цьому сценарію міграції.

## Поведінка

`migratePipelineFile` запускає fail-safe міграцію одного Azure pipeline-файлу: спочатку розбирає документ і відсіює файли поза скоупом, далі бере service path і всі jobs-послідовності, а потім поетапно переписує pipeline до канону plan → lint_<domain> → deploy, зберігаючи коментарі та форматування незачеплених частин через `yaml` Document API. Якщо у файлі є легасі lint-джоба без домену, вона перетворюється на набір domain-style lint-джоб, а якщо вже є domain-style lint-джоби, їм добирається потрібний wiring для запуску після `plan`. Після цього залежності інших джоб перешиваються на нові lint-імена, і лише джоби з прямими залежностями на умовні lint-джоби отримують Skipped-толерантний condition, якщо власного condition ще немає. Нетривіальні умови не перезаписуються, а template-розкладка залишається недоторканою, бо фіксер працює тільки з уже розгорнутими jobs.

`patterns` задає критерій скоупу міграції: працюють лише pipeline-файли з `trigger.paths.include`, які мають перейти на сервісний канон і відповідають очікуваному перетворенню для service_deploy_pipeline. Саме цей відбір відмежовує файли, які можна безпечно переписати автоматично, від тих, де потрібне ручне рішення автора.

## Публічний API

- migratePipelineFile — Мігрує один pipeline-файл до канону. Повертає true, якщо файл змінено.
- patterns — Один детермінований патерн: для кожного pipeline-файлу з порушеннями запускає
`migratePipelineFile` (plan-джоба, per-domain lint-джоби, перешивка dependsOn).
Помилка міграції окремого файлу не валить прогін — deny лишається детектору
до ручного фіксу.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
