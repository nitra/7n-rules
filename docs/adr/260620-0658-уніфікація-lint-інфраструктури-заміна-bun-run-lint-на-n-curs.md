---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T06:58:20+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Let me read the session transcript more carefully to extract the actual decisions made.
[assistant]
[tool: Bash] {"command":"echo \"=== АДР oxfmt ===\"; cat \"docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md\" 2>/dev/null; echo \"=== Поточний package.json ===\"; cat package.json | python3 -c \"import sys, json; d=json.load(sys.stdin); [print(k,':', v) for k,v in d.get('scripts', {}).items()]\""}
[user]
[tool_result] === АДР oxfmt ===
---
type: ADR
title: "Відокремлення oxfmt від lint-ланцюжка"
---

# Відокремлення oxfmt від lint-ланцюжка

**Status:** Accepted
**Date:** 2026-06-20

## Context and Problem Statement

`oxfmt .` застосовує code formatting, тоді як lint-крок...
[assistant]
[thinking]

[assistant]
Вже є автоматично згенеровані ADR-чернетки. Але гляну поточний стан `package.json` і orchestra.mjs — що реально реалізовано в коді вже. Transcript демонструє, що мої зміни в orchestrate.mjs відбулись, а `package.json` вже переписаний до фінального стану.

Let me now understand what the completed transcript contains and write the ADR(s). The user has a hook that auto-calls this ADR normalization step. I need to analyze the transcript and output ADR(s) based on the actual decisions made.

Key decisions from the transcript:

1. **Unification of lint infrastructure**: Remove `bun run lint` chain in `package.json` and replace it with `n-cursor lint --full` as the single entry point.

2. **Python rule integration into `n-cursor lint`**: Add `"lint": "full"` to `python/meta.json` and create `js/lint.mjs` adapter that delegates to `lint/lint.mjs` - with `readOnly` support.

3. **oxfmt integration into the orchestrator**: Run `oxfmt .` in the orchestrator (not `--read-only`), i.e., always in fix-mode when running `n-cursor lint` without `--read-only`. This replaces having it as a separate `package.json` script.

4. **n-lint skill update**: Update the `/n-lint` skill to use `n-cursor lint --full` instead of `bun run lint`.

Let me now write proper MADR-format ADRs for these decisions.

I see there are already some ADRs generated (about "уніфікація lint" and "відокремлення oxfmt"), but I need to write what the actual session decisions were. The "відокремлення oxfmt" title seems contradictory to the actual decision (the decision was to *integrate* oxfmt into n-cursor lint, not separate it).

I'll write comprehensive ADRs based on what I see from the transcript.
</thinking>

## ADR Уніфікація lint-інфраструктури: заміна `bun run lint` на `n-cursor lint --full`

## Context and Problem Statement
У монорепо паралельно існували два механізми лінту: `bun run lint` (ланцюжок з 9 `lint-*`-скриптів у кореневому `package.json`) та `n-cursor lint` (оркестратор правил). Це спричиняло дублювання й дві різні точки входу для CI і скілів.

## Considered Options
* Лишити обидва механізми
* Влити `bun run lint` у `n-cursor lint --full` і прибрати всі `lint-*`-обгортки з `package.json`

## Decision Outcome
Chosen option: "Влити `bun run lint` у `n-cursor lint --full` і прибрати всі `lint-*`-обгортки", because 7 з 9 кроків вже були реалізовані правилами `n-cursor lint`, а наявні обгортки (`lint-doc-files`, `lint-ga`, `lint-js`, `lint-python`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`) лише дублювали оркестрування без додаткової цінності.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу `n-cursor lint --full` замість 9 розрізнених скриптів; скіл `/n-lint` та CI використовують одну команду.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `package.json` (видалено `lint-doc-files`, `lint-ga`, `lint-js`, `lint-python`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`, `oxfmt`; `"lint"` замінено на `n-cursor lint --full`). Скіл `.cursor/skills/n-lint/SKILL.md` оновлено з `bun run lint` на `n-cursor lint --full`.

---

## ADR Інтеграція правила `python` у `n-cursor lint`

## Context and Problem Statement
Правило `python` (ruff/mypy через uv) мало lint-логіку у `lint/lint.mjs`, але оркестратор `n-cursor lint` шукає адаптер у `js/lint.mjs`. Через відсутність `"lint"` у `meta.json` python-крок не виконувався при `n-cursor lint --full`.

## Considered Options
* Інтегрувати: додати `"lint": "full"` у `python/meta.json` і написати `js/lint.mjs`-адаптер
* Лишити python окремим кроком поза оркестратором

## Decision Outcome
Chosen option: "Інтегрувати: `js/lint.mjs`-адаптер + `"lint": "full"` у `meta.json`", because рішення було прийнято явно користувачем ("Python А"), щоб python потрапив у єдину точку входу.

### Consequences
* Good, because transcript фіксує очікувану користь: python автоматично охоплюється `n-cursor lint --full`; `readOnly`-режим пробрасується в ruff/mypy, що коректно для CI (нуль мутацій).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові/змінені файли: `npm/rules/python/meta.json` (додано `"lint": "full"`), `npm/rules/python/js/lint.mjs` (новий адаптер — делегує до `runLintPython` з прокидуванням `readOnly`), `npm/rules/python/js/docs/lint.md` (docgen-doc із crc `a0d17a44`), `npm/rules/python/lint/lint.mjs` (підтримка `readOnly`-параметра). Gating на `pyproject.toml` лишився у самому `lint.mjs`: якщо файл відсутній — exit 0.

---

## ADR Інтеграція `oxfmt` в оркестратор `n-cursor lint`

## Context and Problem Statement
`oxfmt .` (whole-tree code formatting) виконувався як окремий `"oxfmt"` скрипт у `package.json` і не входив до `n-cursor lint`. Після прибирання `package.json`-обгорток він ризикував повністю випасти з lint-циклу.

## Considered Options
* Вмонтувати `oxfmt .` у `npm/rules/lint/js/orchestrate.mjs` як fix-крок (пропускати в `--read-only`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Вмонтувати `oxfmt .` в оркестратор як fix-крок", because користувач явно зазначив: «потрібно щоб він викликався в `n-cursor lint` завжди, коли не передано `--read-only`».

### Consequences
* Good, because transcript фіксує очікувану користь: форматування гарантовано виконується при кожному `n-cursor lint` у dev/fix-режимі; CI з `--read-only` залишається без мутацій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/rules/lint/js/orchestrate.mjs` — додано виклик `runOxfmt(cwd)` до fix-фази (перед або після правил), умова `!opts.readOnly`. `oxfmt` використовується через `spawnSync` або власний хелпер.
