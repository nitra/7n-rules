---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T07:16:14+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

ok wait I need to check "Хто кличе 'n-cursor lint <rule>'"
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor\ngrep -rn \"lint\" hk.pkl | head -20\necho \"====='\"\ngrep -n 'n-cursor lint' hk.pkl 2>/dev/null | head -10"}
[user]
[tool_result] 3:local linters = new Mapping<String, Step> {
4:    ["n-cursor.js"] = new Step {
5:        run = \"\"\"bunx -s node \\
7:            \"npm/bin/n-cursor.js\",
8:            \"npm/types/bin/n-cursor.js\",
9:            \"npm/types/bin/n-cursor.d.ts\"\n        \"\"\".trim()
11:        fix = "cd npm && bunx -p typescript tsc -p tsconfig.emit-types.json && find types -type f ! -path 'types/bin/n-cursor.d.ts' -delete"
12:    }
13:    ["n-cursor.d.ts"] = new Step {
14:        run = \"\"\"bunx -s node \\
15:16:        \"npm/types/bin/n-cursor.d.ts\"\n        \"\"\".trim()
[assistant]
[thinking]

[assistant]
`hk.pkl` не кличе `n-cursor lint <rule>` — лише перевіряє JS-синтаксис bin-файлів. Безпечно.

Тепер я маю повне розуміння. Ось дизайн рішення, яке я пропоную:

## Дизайн: `n-cursor lint <rule>` = повноцінний per-rule запуск

### Проблема

Зараз позиційний rule-filter у `orchestrate.mjs` iде в гілку `runConformance(cwd, readOnly, log, rules)` — тобто **тільки конформність**, без `js/lint.mjs`.

### Рішення: двофазний per-rule запуск

Коли передано `rules`, виконати обидві фази в порядку:

1. **Lint-фаза**: для кожного правила з `rules` — якщо є `js/lint.mjs` → запустити `lint(files, cwd)` (або `lint(undefined, cwd)` для `full`-правил). Це охоплює actionlint+zizmor, oxlint, trufflehog, etc.
2. **Conformance-фаза**: для кожного правила з `rules` → `runConformance(cwd, readOnly, log, [rule])`. Це те, що вже є.

### Що це дасть

| Команда | Зараз | Після |
|---|---|---|
| `n-cursor lint ga` | тільки конформність | lint (actionlint+zizmor) + конформність |
| `n-cursor lint --full` | усі правила, обидві фази | без змін |
| `n-cursor lint security` | тільки конформність | lint (trufflehog) + конформність |
| `n-cursor lint python` | тільки конформність | lint (ruff+mypy) + конформність |

### Наслідки для package.json / CI

CI-workflow `lint-ga.yml` кличе `bun run lint-ga` (→ `n-cursor lint-ga` окрема команда). **Якщо `n-cursor lint ga` стане повноцінним еквівалентом** — `lint-ga.yml` можна переписати на `n-cursor lint ga`. Але **npx-silent-0 footgun** (з `n-ga.mdc`) лишається для зовнішніх споживачів. В рамках CI цього репо `bun run lint-ga` безпечний — і можемо переписати workflow на `bun run n-cursor-lint -- ga` або просто оновити `lint-ga` скрипт на `n-cursor lint ga` через package.json.

### До `package.json`

Після цієї зміни стає можливим:
- `"lint-ga": "bun run start lint ga"` — лишається, але тепер тонкий аліас
- або зовсім прибрати і кликати `n-cursor lint ga` напряму в CI

---

Підтверджуєш дизайн? Якщо так — одразу починаю реалізацію в `orchestrate.mjs`. Єдиний нетривіальний момент: треба правильно **визначити, які файли передавати** (per-file правила в rule-scoped режимі — `undefined` чи git-changed files?).
[user]
[thinking]
This is the transcript that ends here. The user was analyzing and planning a refactoring of the lint infrastructure, and the conversation ended mid-discussion with the user asking about whether calling `n-cursor lint` with a rule argument would be equivalent to `bun run lint-ga`, and then asking how to make the orchestrator run everything (both the linting phase and conformance) when called with a rule argument.

Now I need to analyze this transcript and produce ADR documentation about the decisions made or being made.

Let me identify the key decisions:

1. **Unification of `bun run lint` into `n-cursor lint`** - decided to merge all lint infrastructure into `n-cursor lint --full` as the single entry point
2. **Python lint integration** - Option A: add `"lint": "full"` to `python/meta.json` + adapter `js/lint.mjs` that delegates to existing `lint/lint.mjs`
3. **oxfmt integration** - integrate into `n-cursor lint` always when not `--read-only` (not keep as separate script)
4. **Removing package.json wrappers** - clean all lint-* wrappers (though some must remain due to policy/CI requirements - this was discovered mid-session)
5. **Two-phase per-rule execution** - when a rule is specified, run both lint phase (js/lint.mjs) AND conformance phase, making `n-cursor lint ga` equivalent to `bun run lint-ga`

These are all design decisions. Let me produce ADR documentation.
</thinking>

## ADR Уніфікація lint-інфраструктури: злиття `bun run lint` у `n-cursor lint`

## Context and Problem Statement
У репозиторії співіснували два паралельних lint-механізми: `bun run lint` (9-крок послідовний ланцюг у `package.json`) і `n-cursor lint --full` (оркестратор `orchestrate.mjs` із правилами через `js/lint.mjs`). Підтримка обох дублювала логіку та вимагала синхронізації при змінах кожного правила.

## Considered Options
* Влити логіку в `n-cursor lint --full`, прибрати umbrella-скрипт і зайві `lint-*`-обгортки з `package.json`.
* Лишити обидва механізми (не обговорювалося в transcript як реальна альтернатива).

## Decision Outcome
Chosen option: "Влити `bun run lint` у `n-cursor lint`", because `n-cursor lint --full` вже покривав 7 із 9 кроків — залишалось інтегрувати python і oxfmt, а `package.json`-ланцюг став зайвою обгорткою. Аналіз Rego-політик виявив, що `lint-ga`, `lint-js`, `lint-style`, `lint-text` потрібно лишити як тонкі аліаси (CI + policy constraint), а `lint-doc-files`, `lint-python`, `lint-rego`, `lint-security`, `oxfmt` та umbrella `lint` можна прибрати.

### Consequences
* Good, because `n-cursor lint --full` стає єдиною точкою входу для lint, усуваючи дублювання 9-крокового ланцюга.
* Bad, because `npm/rules/bun/policy/package_json/package_json.rego` наразі примусово вимагає umbrella `lint` із ланцюгом `bun run lint-*` і суфіксом `&& oxfmt .` — зміна вимагає переписування цієї Rego-політики і її тестів.

## More Information
- `npm/rules/lint/js/orchestrate.mjs` — оркестратор, що отримав крок `runOxfmt` (fix-режим, без `--read-only`).
- `npm/rules/python/meta.json` — додано `"lint": "full"`; `npm/rules/python/js/lint.mjs` — адаптер-делегат до `lint/lint.mjs`.
- `npm/rules/bun/policy/package_json/package_json.rego:48-67` — поточна Rego-вимога umbrella `lint`; підлягає переписуванню.
- CI-використання: `.github/workflows/lint-ga.yml:42` викликає `bun run lint-ga`; `lint-ga` і `lint-text` лишаються через npx-silent-0 footgun, задокументований у `n-ga.mdc`.

---

## ADR Інтеграція oxfmt у `n-cursor lint` у fix-режимі

## Context and Problem Statement
`oxfmt .` (форматування JS-файлів і кореневих конфігів) викликався окремим скриптом `"oxfmt": "oxfmt ."` у `package.json` і фінальним кроком umbrella `lint`. Існувала Accepted ADR «Відокремлення oxfmt від lint-ланцюжка» з аргументом «лінтер не має мутувати файли під час перевірки».

## Considered Options
* Інтегрувати `oxfmt` у `orchestrate.mjs`: викликати у fix-режимі, не викликати при `--read-only`.
* Лишити `oxfmt` окремим скриптом (позиція попередньої ADR «Відокремлення oxfmt»).

## Decision Outcome
Chosen option: "Інтегрувати oxfmt у `orchestrate.mjs`", because `n-cursor lint` у fix-режимі вже мутує файли через `eslint --fix`, `stylelint --fix`, `ruff --fix`, `markdownlint --fix` — аргумент «лінтер не мутує» не відповідає реальній поведінці, тому oxfmt консистентно вписується туди ж. ADR «Відокремлення oxfmt» видаляється.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний fix-прохід охоплює форматування разом із лінтингом, без окремого кроку.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/lint/js/orchestrate.mjs` — крок `runOxfmt` додано перед фазами правил; умова `!readOnly` гарантує відсутність мутацій у CI-режимі.
- Видалена чернетка: `docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md`.

---

## ADR Інтеграція python-лінту в оркестратор через `js/lint.mjs`-адаптер

## Context and Problem Statement
Правило `python` мало реалізацію в `npm/rules/python/lint/lint.mjs` (ruff + mypy через uv), але оркестратор `orchestrate.mjs` шукає лише `npm/rules/<id>/js/lint.mjs`. Через відсутній `"lint"`-scope у `meta.json` python-лінт не запускався через `n-cursor lint --full`.

## Considered Options
* Додати `"lint": "full"` у `python/meta.json` + тонкий адаптер `js/lint.mjs`, що делегує до наявного `lint/lint.mjs`.
* Лишити python окремою підкомандою поза оркестратором.

## Decision Outcome
Chosen option: "Адаптер `js/lint.mjs` + `\"lint\": \"full\"` у `meta.json`", because це повторює усталений патерн правила `ga` (тонкий делегат у `js/lint.mjs` → реальна логіка у `lint/lint.mjs`) і не дублює наявну реалізацію.

### Consequences
* Good, because `n-cursor lint --full` автоматично охоплює python-лінт без окремого скрипта.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/python/js/lint.mjs` — новий адаптер; приймає `readOnly`-параметр і пробрасовує до `runLintPython`.
- `npm/rules/python/lint/lint.mjs` — оновлено сигнатуру `runLintPythonSteps`/`runLintPython` для підтримки `readOnly` (ruff `check` без `--fix`, без виклику `ruff format`).
- `npm/rules/python/js/docs/lint.md` — новий doc-файл із `docgen.crc: a0d17a44`.
- Glob-gate `pyproject.toml` лишається: якщо файл відсутній — крок завершується з кодом 0 без запуску інструментів.

---

## ADR Двофазний запуск `n-cursor lint <rule>`: lint + conformance

## Context and Problem Statement
При виклику `n-cursor lint <rule>` оркестратор виконував тільки conformance-фазу (`runConformance`), пропускаючи `js/lint.mjs` правила. Через це `n-cursor lint ga` не еквівалентний `bun run lint-ga` (actionlint + zizmor не запускались), і правило не можна використати як заміну `lint-*` скрипту в CI.

## Considered Options
* Запускати обидві фази послідовно: спочатку `js/lint.mjs` (lint-фаза), потім `runConformance` (conformance-фаза) — коли передано позиційний аргумент-правило.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Двофазний per-rule запуск у `orchestrate.mjs`", because це зробить `n-cursor lint ga` повноцінним еквівалентом `bun run lint-ga` і дозволить уніфікувати CI-виклики через єдиний оркестратор.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor lint <rule>` стає повноцінною заміною `lint-<rule>` підкоманди, усуваючи потребу в дублюванні `case 'lint-ga'` тощо в `n-cursor.js`.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — рішення було зафіксоване як дизайн наприкінці сесії, реалізація не завершена.

## More Information
- `npm/rules/lint/js/orchestrate.mjs` — цільова точка зміни: гілка rule-filter замість `return runConformance(...)` має виконати lint-фазу (`js/lint.mjs`) і потім conformance.
- Стосується правил: `ga` (actionlint + zizmor), `security` (trufflehog), `python` (ruff + mypy), `text`, `rego`, `doc-files`.
- Відкрите питання в кінці сесії: як визначити `files` для per-file правил у rule-scoped режимі (`undefined` чи git-changed files).
