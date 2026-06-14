---
session: 8e308db4-fee9-44b0-bd83-2a55c74e2dc0
captured: 2026-06-14T18:04:53+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8e308db4-fee9-44b0-bd83-2a55c74e2dc0.jsonl
---

## ADR Класифікація omlx-збоїв на transient / systemic / permanent

## Context and Problem Statement
Масовий прогін docgen (266 файлів) продукував каскад фейлів із трьох принципово різних причин: ETIMEDOUT curl-помилки без ретраю, лавинне вичерпання RAM (memory ceiling) після завантаження конкурентної моделі, та спроби обробити 14.5 MB Emscripten-blobs — але оркестратор обробляв усі три однаково: `catch → ✗ → continue`. Це призвело до того, що на 58-му файлі каскад systemic-фейлів знищував решту ~200 файлів без жодного сигналу.

## Considered Options
* Єдиний catch-all handler (поточне)
* Класифікатор помилок (transient / systemic / permanent) з різними стратегіями реагування
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Класифікатор помилок із трьома гілками", because це відповідає природі збоїв — кожен клас вимагає іншої відповіді, а не однакового ігнорування.

### Consequences
* Good, because transcript фіксує очікувану користь: transient ETIMEDOUT тепер ретраїть з backoff (2s→8s), systemic-каскад зупиняється після 3 підряд (exit 2 без cooldown, щоб «швидше помилятись і рухатись далі»), permanent-файли стають `skipped[]` без витраченого POST.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Класифікатор `classifyOmlxError(message) → 'transient' | 'systemic' | 'permanent'` додано в `npm/lib/llm.mjs`
- `callOmlxRaw` (`npm/lib/omlx.mjs`): ETIMEDOUT→transient-гілка + backoff `[2000, 8000]` мс (хардкод, override `backoffMs` у opts для тестів)
- Circuit-breaker: `SYSTEMIC_ABORT_STREAK = 3`, `stats.systemicStreak` у головному циклі `docgen-files-batch.mjs` → `exit 2`
- permanent (наприклад `Prompt too long`) → `stats.skipped[]`, окремий рядок у звіті
- `DEFAULT_OMLX_MODEL` хардкод видалено з `npm/lib/omlx.mjs` та `npm/rules/doc-files/js/docgen-gen.mjs`; модель резолвиться виключно через `N_LOCAL_MIN_MODEL` / `resolveModel('min')`, при відсутності — fail-loud
- Scan поважає `.gitignore` через `git check-ignore --stdin` (`npm/rules/doc-files/js/docgen-scan.mjs`), stderr заглушено (graceful поза git-репо)
- `~/.omlx/settings.json`: `model_fallback: true` — запити до відсутньої моделі не дають 404 (підтверджено тестом на `foo-bar-baz`)
- Спека: `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md` (Approved 2026-06-14)
- Changeset: `npm/.changes/260614-1753.md` (minor/Changed)
- Новий тест-файл: `npm/rules/doc-files/js/tests/docgen-files-batch.test.mjs` (circuit-breaker + skip)
