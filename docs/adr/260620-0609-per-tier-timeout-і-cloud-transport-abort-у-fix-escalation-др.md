---
session: 91ef735b-1750-4c3d-bac1-6f0627451d63
captured: 2026-06-20T06:09:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/91ef735b-1750-4c3d-bac1-6f0627451d63.jsonl
---

Файл потребує підтвердження — поки що ось повний ADR-вміст:

---

## ADR Per-tier timeout і cloud-transport abort у fix-escalation-драбині

## Context and Problem Statement

`lint --full` з LLM-фіксом запускає escalation-драбину `local-min → local-min-retry → cloud-min → cloud-avg`. Спостережений прогін виявив дві проблеми: (1) локальний 4b-рунг на правилі `adr` впирався в хардкодовану стіну 120 000 ms у `callModel` → `callLlm` (`curl 28 — operation timed out after 120006 ms`), даремно займаючи 2 × 120 s до ескалації на хмару; (2) після `pi ETIMEDOUT` на `cloud-min` (ms ≈ 120 450) `decideAfterFailure` продовжував ескалацію на `cloud-avg`, який теж падав з ETIMEDOUT (ms ≈ 120 383) — один із трьох avg-слотів горів за ту саму транспортну стіну.

## Considered Options

* Per-tier `timeoutMs` у рунгах `buildLadder` + `break` після cloud-transport-збою в `decideAfterFailure`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "per-tier `timeoutMs` + cloud-transport abort", because це вирішує обидві проблеми мінімальним прицільним патчем без зміни семантики драбини: local-рунги fail-fast без очікування хмарного таймауту, а cloud-avg не запускається, коли cloud-min вже не встиг за тим самим мережевим бар'єром.

### Consequences

* Good, because локальні рунги тепер fail-fast (~45 s замість 120 s), що скорочує час очікування на `adr`-правилах з повільним 4b-моделем.
* Good, because cloud-avg-слот не витрачається після cloud-transport timeout — escalation-лог фіксує збережений виклик ms ≈ 120 383.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

**Змінені файли (коміт `528d75e3`):**
- `npm/scripts/lib/fix/orchestrator.mjs` — `buildLadder` додає `timeoutMs` per-рунг (`local: N_LOCAL_FIX_TIMEOUT_MS ?? 45_000`, `cloud: N_CLOUD_FIX_TIMEOUT_MS ?? 120_000`); `decideAfterFailure` додає `isCloudTimeout` (`CLOUD_TRANSPORT_RE = /ETIMEDOUT|timed out|spawnSync.*ETIMEDOUT/i`) → `'break'` для не-local рунгів.
- `npm/scripts/lib/fix/llm-worker.mjs` — `callModel`/`runLlmWorker` приймають і прокидають `opts.timeoutMs` у `callLlm` (раніше хардкод `120_000`).
- `npm/scripts/lib/fix/tests/orchestrator.test.mjs` — +3 тести.

**Env-змінні:** `N_LOCAL_FIX_TIMEOUT_MS` (дефолт 45 000), `N_CLOUD_FIX_TIMEOUT_MS` (дефолт 120 000). Changelog: `npm/.changes/260619-1716.md` (patch, Fixed).

---

Phase 1 запушено в main (`528d75e3`). ADR-файл очікує дозволу на запис у `docs/adr/260620-0630-per-tier-timeout-і-cloud-abort-у-fix-escalation-драбині.md` — дай `allow` і напишу.
