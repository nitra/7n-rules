---
type: ADR
status: Accepted
date: 2026-06-06
---

## ADR Автономний оркестратор скілів: атрибут `orchestrator` у `meta.json` та convergence-loop через CLI

## Context and Problem Statement
Скіли типу `n-fix`, `n-lint`, `n-taze` містили логіку "як виправляти" у `SKILL.md`, яку читав агент-LLM і виконував вручну. Convergence-loop, ескалація моделей і рішення що виправляти — все покладалось на агента. Потрібна була єдина декларативна ознака у `meta.json`, яка б сигналізувала CLI: цей скіл самодостатній — агент лише викликає команду й очікує exit 0/1.

## Considered Options
* `"orchestrator": true` у `meta.json` — CLI маршрутизує команду до автономного convergence-loop
* Залишити логіку в `SKILL.md` (агент читає інструкцію і сам виконує кроки)

## Decision Outcome
Chosen option: `"orchestrator": true` у `meta.json`, because це дає єдиний принцип: CLI сам вирішує check → T0-auto → LLM-tier → recheck, а `SKILL.md` зводиться до одного рядка — виклику CLI-команди. Атрибут відпрацьований на `n-fix` (де `meta.json` вже містить `"orchestrator": true`), і після підтвердження результату той самий атрибут буде проставлено у `meta.json` інших скілів.

### Consequences
* Good, because агент не несе відповідальності за логіку виправлення — `SKILL.md` скорочується до `npx @nitra/cursor fix && npx @nitra/cursor lint`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/fix/meta.json`: `{ "auto": "завжди", "worktree": true, "orchestrator": true }`
- `npm/skills/fix/js/orchestrator.mjs`: T0 check-gate → T0-auto (`fix-t0`) → T1 LLM-worker → loop до `--max-iter` (default 3)
- `npm/skills/taze/meta.json`, `npm/skills/lint/meta.json`: заплановано додати `"orchestrator": true` після верифікації на `fix`

---

## ADR C1-патерн LLM-tier: script збирає контекст, `pi` повертає повний файл

## Context and Problem Statement
LLM-tier у `llm-worker.mjs` потребував читати та писати файли проєкту. Початкова реалізація використовувала Anthropic SDK з tool-use (read_file / write_file). Постало питання який патерн взаємодії між orchestrator і LLM застосовувати, а також через який інтерфейс передавати API-ключі.

## Considered Options
* C1 — orchestrator сам читає файли, будує self-contained prompt, `pi` повертає повний виправлений файл цілком, orchestrator записує
* C2 — `pi --tools read_file,write_file`, LLM сам читає/пише через tool-use
* SDK Anthropic з tool-use (початковий варіант)

## Decision Outcome
Chosen option: "C1 — script збирає контекст, `pi` повертає JSON зі змінами", because LLM-tier стає stateless (без tool-use), а orchestrator залишається повністю під контролем. Це відповідає патерну "script parses, agent gets slice". Крім того, всі LLM-виклики йдуть через `pi` — кожен користувач самостійно налаштовує ключі доступу в `pi`, без залежності від `ANTHROPIC_API_KEY` у проєкті.

### Consequences
* Good, because `llm-worker.mjs` будує prompt з `.mdc`-правила + violation output + вміст файлів → `pi -p "..." --no-session --mode text --no-tools` → парсить JSON `{"changes":[{"path":"...","content":"..."}]}` → orchestrator застосовує `writeFileSync`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/fix/js/llm-worker.mjs`: функції `extractFilePaths`, `buildPrompt`, `callPi`, `parseResponse`, `runLlmWorker`
- Ескалація: `MODEL_HAIKU` (default `''` = pi default model) → `MODEL_SONNET` після 2 провалів підряд на одному rule; env-override: `N_CURSOR_FIX_MODEL_HAIKU` / `N_CURSOR_FIX_MODEL_SONNET`
- `gemma4:4b` заборонена без явного дозволу користувача (>120s → ETIMEDOUT)
- `pi` виклик без `--model`: використовує subscription default (GPT-5 через openai-codex); з `--model <name>` — роутить через azure-openai-responses (потребує окремий ключ)
- Внутрішня команда `_fix-check` (замість публічного `fix --json`) для check-gate всередині orchestrator і `t0.mjs`

---

## ADR Послідовне виконання `fix` → `lint` у межах одного worktree

## Context and Problem Statement
Агент, що вирішує задачу у власному worktree, може потребувати запустити `fix` і `lint`. Постало питання: запускати їх послідовно в тому самому worktree чи паралельно — кожен у своєму під-worktree з подальшим merge.

## Considered Options
* Послідовно в одному worktree: `fix` → `lint` → done
* Паралельно у двох під-worktrees від поточного worktree + merge результатів

## Decision Outcome
Chosen option: "послідовно в одному worktree", because `fix` і `lint` не є незалежними — `fix` може створювати структурні файли (configs, `extensions.json`, `package.json`), які `lint` одразу перевіряє. Паралельний підхід гарантує конфлікти на спільних файлах і потребує складної merge-логіки.

### Consequences
* Good, because transcript фіксує очікувану користь: жодних конфліктів на `package.json` / config-файлах; природна залежність між `fix` і `lint` збережена.
* Bad, because послідовний запуск повільніший за паралельний.

## More Information
- Агент у своєму worktree: `npx @nitra/cursor fix && npx @nitra/cursor lint`
- Правило "без паралельних `eslint`-запусків" закріплено в кореневому `CLAUDE.md`

## Update 2026-06-06

- Публічний контракт skill має бути автономною CLI-командою: агент викликає `npx @nitra/cursor fix` і отримує exit `0` або `1`, а convergence-loop живе всередині CLI.
- `meta.json` використовує ознаку `"orchestrator": true` для таких скілів.
- `fix --json` прибрано з публічного API; внутрішня перевірка винесена в `_fix-check`, а `fix-run` лишається deprecated alias на `fix`.
- LLM-tier оркестратора викликається через `pi -p "..." --no-session`, без прямої залежності від `ANTHROPIC_API_KEY`; моделі перемикаються через `N_CURSOR_FIX_MODEL_HAIKU` / `N_CURSOR_FIX_MODEL_SONNET`.
- Якщо в `pi` не налаштовано provider, LLM-tier падає з `No API key found`; користувачу потрібен `pi /login`.
- `fix` і `lint` виконуються послідовно в одному worktree, бо `fix` змінює конфіги, які потім має бачити `lint`; паралельні під-worktree створювали б конфлікти.
