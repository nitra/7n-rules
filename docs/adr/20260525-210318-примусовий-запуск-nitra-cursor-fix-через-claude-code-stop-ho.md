---
session: a159a310-54ca-4004-9344-9a953824d66b
captured: 2026-05-25T21:03:18+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/a159a310-54ca-4004-9344-9a953824d66b.jsonl
---

## ADR Примусовий запуск `@nitra/cursor fix` через Claude Code Stop hook

## Context and Problem Statement
Після кожного ходу агента (Claude Code) проєктні правила з `.cursor/rules/` можуть бути порушені — і без явного примусового контролю агент завершує хід без гарантії чистоти. Потрібен механізм, що унеможливлює повернення керування користувачу, доки правила не виконано.

## Considered Options
* Синхронний Stop hook з `npx --no @nitra/cursor fix`, що блокує через exit code
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Синхронний Stop hook з `npx --no @nitra/cursor fix`", because `.claude/settings.json` налаштовує Stop hook із `type: "command"`, `timeout: 60`, без `async` — тобто блокувальний. Хук у `npm/scripts/claude-stop-hook.mjs` запускає `npx --no @nitra/cursor fix` через `spawn` і повертає його exit code агенту; при ненульовому коді агент отримує сигнал «не зупиняйся, виправ це» через stderr.

### Consequences
* Good, because transcript фіксує очікувану користь: агент фізично не може завершити хід із порушеними правилами — `fix` виступає автоматичним лінтером-блокером.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `.claude/settings.json` → `hooks.Stop[0]`: `npx --no @nitra/cursor stop-hook`, timeout 60s
* `npm/scripts/claude-stop-hook.mjs` — реалізація хука
* Exit code `2` у Stop hook → Claude Code не завершує хід, повертає stderr агенту як інструкцію

---

## ADR Захист від рекурсії Stop hook через прапор `stop_hook_active`

## Context and Problem Statement
Коли Stop hook повертає exit code `2`, Claude Code знову запускає агента, який знову сигналізує Stop — і хук викликається вдруге. Без захисту це утворює нескінченний цикл.

## Considered Options
* Перевірка поля `stop_hook_active` із stdin-JSON перед запуском `fix`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перевірка поля `stop_hook_active` із stdin-JSON", because `claude-stop-hook.mjs` першим ділом читає stdin і при `stop_hook_active: true` негайно виходить з exit code `0` — передаючи Claude Code дозвіл на завершення й уникаючи повторного запуску `fix`.

### Consequences
* Good, because transcript фіксує очікувану користь: гарантується, що другий Stop у межах одного циклу виправлення не запускає `fix` рекурсивно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `npm/scripts/claude-stop-hook.mjs` — рядки перевірки `stop_hook_active`
* Поле надходить від Claude Code у stdin у форматі JSON при повторному виклику після блокування

---

## ADR ADR-автоматизація як async Stop hooks (capture + normalize)

## Context and Problem Statement
Збір рішень сесії та нормалізація ADR-чернеток потребують часу (до 600 секунд) і не повинні затримувати повернення керування користувачу, на відміну від обов'язкового `fix`.

## Considered Options
* Запуск `capture-decisions.sh` і `normalize-decisions.sh` з прапором `async: true` у Stop hooks
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Async Stop hooks з `async: true`", because `.claude/settings.json` додає два окремих Stop-записи для `.claude/hooks/capture-decisions.sh` (timeout 180s) та `.claude/hooks/normalize-decisions.sh` (timeout 600s) з `async: true` — fire-and-forget, не блокують завершення ходу.

### Consequences
* Good, because transcript фіксує очікувану користь: ADR-автоматизація не додає затримки до суб'єктивного часу відповіді агента.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `.claude/hooks/capture-decisions.sh` — лог: `.claude/hooks/capture-decisions.log`
* `.claude/hooks/normalize-decisions.sh` — лог: `.claude/hooks/normalize-decisions.log`
* Пов'язаний skill: `n-adr-normalize`
