---
session: 8e308db4-fee9-44b0-bd83-2a55c74e2dc0
captured: 2026-06-14T17:13:01+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8e308db4-fee9-44b0-bd83-2a55c74e2dc0.jsonl
---

## ADR Класифікація помилок omlx у docgen-оркестраторі (transient / systemic / permanent)

## Context and Problem Statement
`docgen-files-batch.mjs` обробляє всі збої omlx однаково (`catch → ✗ → push → continue`). Коли на 57-му файлі `memory ceiling` перевищено — наступні ~200 файлів теж фейляться каскадом без зупинки, а мінімізовані vendored-файли (напр. `run/auth/src/lib/lib/euscp.js`, 9.17M токенів) марно витрачають curl-раунд, бо ретрай детерміновано не допоможе.

## Considered Options
* Єдиний retry-шлях для всіх помилок (поточний стан)
* Тричастинна класифікація: **transient** / **systemic** / **permanent** з різною реакцією

## Decision Outcome
Chosen option: "Тричастинна класифікація помилок", because вона розрізняє відновлювані збої (таймаут одного запиту), системні умови середовища (нестача RAM на хості), та детерміновано-невиправні запити (контекст перевищує 131072 токенів) — і для кожного класу доцільна окрема стратегія.

Запропоновано таку модель:
- **transient** (`ETIMEDOUT`, `curl exit 18/52/56`) → retry×N із exponential backoff (`await sleep`); зараз `ETIMEDOUT` іде у гілку `break` (`omlx.mjs:144-147`), треба перемістити в `continue`;
- **systemic** (`memory ceiling`, сервер недоступний) → streak-лічильник; при K≥3 підряд — circuit breaker: cooldown + повторний `omlxHealthCheck`, або abort із actionable-повідомленням; resume безпечний — невдалі файли лишаються `stale` і підберуться наступним прогоном через CRC;
- **permanent** (`Prompt too long`) → `⊘ skip` в окремий `skipped[]` без ретраю; pre-send guard за розміром файлу; exclude мінімізованих/vendored шляхів ще на рівні `scanForDocFiles`.

### Consequences
* Good, because transcript фіксує очікувану користь: зупинка каскаду при `systemic`-збоях зменшить кількість марних curl-раундів із ~200 до ≤3; `permanent`-клас усуне ретраї на детерміновано-невиправних файлах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл оркестратора: `npm/rules/doc-files/js/docgen-files-batch.mjs`
- Транспортний шар: `npm/lib/omlx.mjs` (функція `callOmlxRaw`, рядки 144-151; preflight `omlxHealthCheck` рядки 137-150)
- Зародок класифікатора вже є в `omlxHealthCheck` (`memory ceiling`→`memory-guard`, `curl`→`down`) — його варто винести у спільний predicate `classifyOmlxError(message)`.
- omlx-сервер має `/admin` API та `/v1/models/status` (підтверджено `curl http://127.0.0.1:8000/openapi.json`); endpoint для скидання моделей/кешу — досліджується окремо.
- Зміни коду на момент завершення сесії ще **не реалізовано** — це запропонована стратегія.
