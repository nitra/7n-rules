---
session: 91ef735b-1750-4c3d-bac1-6f0627451d63
captured: 2026-06-20T05:56:38+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/91ef735b-1750-4c3d-bac1-6f0627451d63.jsonl
---

## ADR fail-fast escalation: per-tier timeout та cloud-transport abort

## Context and Problem Statement
Під час `lint --full` LLM-каскад-fix виявив дві проблеми продуктивності: локальна 4b-модель витрачала повні 120s на hardcoded таймаут (`curl 28`) на правилах типу `adr`; після `pi ETIMEDOUT` на cloud-min драбина продовжувала ескалювати на cloud-avg — витрачаючи обмежений avg-бюджет (cap 3) на повторний таймаут.

## Considered Options
* Per-tier timeout (налаштовний, локалі ≤45s) + обрив на хмарному transport error
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Per-tier timeout + cloud-transport abort", because локальний 4b-рунг об'єктивно не закінчить роботу за 120s на важких промптах (підтверджено логом `curl 28`), а хмарний ETIMEDOUT — це transport-failure, після якого дорожча cloud-avg-модель не додасть нічого за ту саму стіну часу.

### Consequences
* Good, because `decideAfterFailure` тепер обриває драбину (`break`) після cloud-min ETIMEDOUT → cloud-avg не викликається, avg-бюджет зберігається. Підтверджено escalation-логом до патчу: обидва cloud-рунги витрачали ~120s на той самий таймаут.
* Good, because env-змінні `N_LOCAL_FIX_TIMEOUT_MS` (дефолт 45s) і `N_CLOUD_FIX_TIMEOUT_MS` (дефолт 120s) дозволяють налаштовувати таймаути без зміни коду.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/scripts/lib/fix/orchestrator.mjs` — `buildLadder` (додані `timeoutMs` per-rung), `decideAfterFailure` (додана гілка `isCloudTimeout` → `'break'`); `npm/scripts/lib/fix/llm-worker.mjs` — `callModel`/`runLlmWorker` приймають і прокидають `opts.timeoutMs`.
- Тести: `npm/scripts/lib/fix/tests/orchestrator.test.mjs` — +3 тести: per-tier timeout у ladder, timeout прокидається в worker opts, cloud-transport abort (`avgUsed === 0`).
- Закомічено у `bf38eefd` (main), change-файл `npm/.changes/260619-1716.md`.
- Escalation-лог `.n-cursor/fix-escalation.jsonl` підтвердив патерн: `npm-module cloud-min → ETIMEDOUT ms:120450` → `cloud-avg → ETIMEDOUT ms:120383`.
