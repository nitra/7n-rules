---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T16:17:20+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

Based on the transcript, the following design decisions were made. I'll emit the ADR documentation.

---

## ADR: Автономні CLI-оркестратори з єдиним контрактом (`meta.json` → `orchestrator: true`)

## Context and Problem Statement
n-cursor CLI-команди (`fix`, `lint`, `taze`) були лише чекерами: вони виявляли порушення та виводили їх у stdout, а агент (LLM) зчитував SKILL.md і виправляв проблеми самостійно по 8 кроках. Це означало, що логіка "як виправляти" жила у SKILL.md, а не в CLI, тому SKILL.md був складним, агент часто витрачав зайві токени на парсинг, і не існувало єдиного місця для convergence-loop та ескалації тирів.

## Considered Options
* Залишити поточну схему: агент читає SKILL.md і оркеструє кроки вручну
* Зробити CLI-команди автономними оркестраторами з convergence-loop, T0-auto та LLM-tier через `pi`; `meta.json` декларує `"orchestrator": true`

## Decision Outcome
Chosen option: "Автономні CLI-оркестратори", because агент повинен лише викликати `npx @nitra/cursor fix` і дочекатись exit code — вся логіка convergence-loop, T0-auto та ескалації haiku→sonnet живе всередині CLI. Ознака `"orchestrator": true` у `meta.json` скіла сигналізує що команда є самодостатньою; SKILL.md зводиться до одного рядка виклику.

### Consequences
* Good, because SKILL.md більше не містить 8-крокових інструкцій — агент не витрачає токени на розбір workflow.
* Good, because transcript фіксує очікувану користь: fix на чистому репо виконується одним `bun npm/bin/n-cursor.js fix js-run changelog --max-iter 1` і виходить з кодом 0 без LLM-участі.
* Good, because всі LLM-виклики йдуть через `pi` (C1 pattern: script збирає контекст → pi повертає виправлений файл → script застосовує), тому користувач конфігурує ключі доступу самостійно у `pi`, а не в коді.
* Bad, because `fix --json` видалено з публічного API (замінено внутрішньою командою `_fix-check`) — зовнішні CI-скрипти, що покладались на `--json`, потребують міграції.

## More Information
- `npm/skills/fix/meta.json`: `{ "auto": "завжди", "worktree": true, "orchestrator": true }`
- `npm/skills/fix/js/orchestrator.mjs` — convergence-loop: T0-check → T0-auto (`fix-t0`) → LLM-worker (haiku→sonnet через `pi`) → recheck
- `npm/skills/fix/js/llm-worker.mjs` — C1 pattern: script читає rule `.mdc` + файли з violation → `pi -p "..." --no-session --model claude-haiku-4-5` → повертає JSON зі змінами → script застосовує
- `npm/skills/fix/js/t0.mjs` — `applyT0Auto`, `filterT0AutoRules`, `runT0AutoCli`; оновлено: `fix --json` → `_fix-check`
- `npm/bin/n-cursor.js`: `case 'fix'` → `runOrchestratorCli`; `case '_fix-check'` → `runFixCommand` (private); `case 'fix-run'` → deprecated alias
- Виконано: `bun test npm/skills/fix/js/tests/t0.test.mjs` — 11/11 pass
- `docs/adr/260606-1553-autonomous-cli-orchestrators.md` — зафіксований дизайн (Proposed)
- Порядок реалізації решти скілів: fix (done) → taze → lint (найскладніший через policy заборони auto-ignore)
