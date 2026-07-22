---
type: JS Module
title: fix-service_deploy_workflow.mjs
resource: plugins/ci-github/rules/ga/service_deploy_workflow/fix-service_deploy_workflow.mjs
docgen:
  crc: 429bfe4c
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-автоміграція приводить `.github/workflows/deploy-*.yml` сервісів до канону ADR 260718-0835: `plan → lint-<domain> → deploy` із runtime outputs для доменних гейтів. Вона додає `plan` із `bunx n-rules ci plan --path <svc> --github`, `id: plan` та outputs-мапінгом доменів + `any`, щоб умови `needs.plan.outputs.*` мали значення під час виконання.

Файл існує як fix-режим для workflow, що ще мають легасі lint або неповний domain-style wiring, зберігаючи валідні без-lint workflow без примусового переходу на gate. `bootstrap: true` є окремим opt-in для workflow без lint-джоб: він створює доменні lint-гейти з нуля й підключає до них безумовну вхідну job.

Міграція працює fail-safe: перехоплює помилки, не кидає винятків назовні та в окремих збійних сценаріях може повертати `null`.

## Поведінка

`migrateWorkflowFile` читає GitHub Actions deploy-workflow, визначає сервісний каталог і активні домени, після чого детерміновано приводить jobs до канону `plan → lint-<domain> → deploy`. Дані беруться з наявних jobs, lint-команд і workflow paths; результатом є оновлений YAML-файл із мінімальними змінами незачеплених частин.

Потік міграції спочатку формує або доповнює `plan` з outputs для доменів і `any`, щоб downstream-гейти могли коректно читати `needs.plan.outputs.*` під час runtime. Далі легасі lint-job без домену замінюється на набір per-domain jobs, а вже наявні domain-style lint jobs добираються до канону: залежність від `plan`, умовний запуск за outputs, режим без auto-fix, повна історія checkout і підготовчі кроки.

Після створення або оновлення lint jobs міграція перешиває залежності інших jobs з легасі-імен на нові lint jobs. Якщо deploy-job залежить від умовних lint jobs, вона отримує Skipped-толерантний gate, щоб пропущений нерелевантний домен не блокував деплой, але failure залишався блокувальним. Наявний нетривіальний `if` не перезаписується, бо це вважається ручним рішенням.

Опційний bootstrap-режим у `migrateWorkflowFile` застосовується лише як явний opt-in для workflow без lint jobs: він створює per-domain lint jobs з нуля та підключає безумовну вхідну deploy-job до `plan` і всіх lint jobs. Звичайний fix-режим цього не робить, бо workflow без lint-гейта є валідним станом, а перехід на gate має бути свідомим рішенням команди.

Зміни виконуються через YAML document-модель, тому порядок jobs керовано оновлюється, а коментарі й форматування незачеплених ділянок зберігаються. Помилки обробляються fail-safe: міграція не кидає винятки назовні і за неможливості безпечно визначити потрібні дані не виконує небезпечний rewrite.

`patterns` підключає цю міграцію до правила fix для deploy-workflow файлів і застосовує звичайний режим без bootstrap. Під час обходу свідомо пропускаються `.github` і `.git`, щоб не аналізувати службові каталоги як сервісні піддерева.

## Публічний API

- migrateWorkflowFile — Мігрує один deploy-workflow до канону. Повертає true, якщо файл змінено.

`bootstrap: true` — свідоме розширення поза звичайним fix-режимом: для
deploy-workflow БЕЗ жодної lint-джоби (валідний as-is за рего-концерном,
деталі — service_deploy_workflow.rego) створює lint-<domain> джоби з нуля
(за `relevantDomains` піддерева сервісу) і підключає вхідну/термінальну
джобу без `needs` до plan + усіх lint-джоб. Це саме «свідоме рішення
перейти на гейт», про яке говорить коментар концерну — bootstrap лише
виконує його механічно, а не ухвалює автоматично (звичайний
`n-rules lint --fix` bootstrap не викликає: patterns[0].apply завжди
викликається без bootstrap).
- patterns — Один детермінований патерн: для кожного workflow-файлу з порушеннями запускає
`migrateWorkflowFile` без bootstrap (plan-джоба, per-domain lint-джоби,
перешивка needs). Помилка міграції окремого файлу не валить прогін — deny
лишається детектору до ручного фіксу.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `.github`, `.git`.
