---
session: c3ee6058-20c8-4e12-8aef-0a36a996fed5
captured: 2026-05-23T09:42:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/c3ee6058-20c8-4e12-8aef-0a36a996fed5.jsonl
---

## ADR Впровадження `check-{id}.mjs` для правил npm/rules із відсутньою автоматизованою перевіркою

## Context and Problem Statement
Кілька `.mdc`-файлів у `npm/rules` посилалися на `check-{id}.mjs` як на місце розміщення автоматизованої логіки перевірки, але самі файли були відсутні. `npx @nitra/cursor check <rule>` проходив без помилок, проте заявлена перевірка фактично не виконувалася. Додатково `n-ga.mdc` посилалася на `check-n-ga.mjs`, тоді як реальний файл мав назву `check-nitra-ga.mjs`.

## Considered Options
* Створити відсутні `check-{id}.mjs` відповідно до логіки, описаної в `.mdc`
* Прибрати посилання з `.mdc` і залишити перевірку лише в Rego
* Перейменувати `check-nitra-ga.mjs` → `check-n-ga.mjs` (для узгодження з посиланням у `.mdc`) vs. оновити посилання в `.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Створити відсутні `check-{id}.mjs` і перейменувати файл із невідповідною назвою", because cross-file логіка (парність ресурсів у директорії, обчислення похідних полів, валідація patch-overlay) не може бути виражена в Rego — він не читає файлову систему й не виконує cross-document резолюцію; тому вона має жити саме в `check-{id}.mjs`. Перейменування обрано замість правки `.mdc`, щоб назва файлу відповідала конвенції `check-{rule-id}.mjs`.

### Consequences
* Good, because `npx @nitra/cursor check <rule>` тепер фактично виконує перевірки, задекларовані в `.mdc`; всі 7 правил повертають `0 errors`.
* Good, because transcript фіксує очікувану користь: аудит `comm -23` дав вичерпний список відсутніх файлів, що можна повторити в майбутньому для нових правил.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Створені файли: `npm/rules/abie/check-abie.mjs`, `npm/rules/n-bun/check-n-bun.mjs`, `npm/rules/n-ci4/check-n-ci4.mjs`, `npm/rules/n-rego/check-n-rego.mjs`, `npm/rules/n-security/check-n-security.mjs`, `npm/rules/n-vue/check-n-vue.mjs`.
Перейменовано: `npm/rules/n-ga/check-nitra-ga.mjs` → `npm/rules/n-ga/check-n-ga.mjs`.
Команда для аудиту: `comm -23 <(find npm/rules -name "*.mdc" -exec grep -oh "check-[a-zA-Z0-9_-]*\.mjs" {} \; | sort -u) <(find npm/rules -name "check-*.mjs" -exec basename {} \; | sort -u)`.
Утиліти `utils/k8s-tree.mjs` і `utils/kustomization-patches.mjs` використовуються в `check-abie.mjs` для cross-file аналізу.
Скіл `mdc-check` визначає конвенцію: `.mdc` — людинозрозумілий зміст, `check-{id}.mjs` — автоматизована логіка з JSDoc і поверненням `{ file, line, message }[]`.
