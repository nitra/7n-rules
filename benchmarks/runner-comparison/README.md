# runner-comparison

Spike-бенчмарк для порівняння двох Stryker test-runner конфігурацій:

- **`stryker.bun.config.mjs`** — поточний canonical baseline `@nitra/cursor` (command runner + `bun test` + `concurrency: 1` + `inPlace: true`).
- **`stryker.vitest.config.mjs`** — пропонований (vitest-runner + `coverageAnalysis: 'perTest'`, без `inPlace`).

## Sample проєкт

`demo/` — standalone (не у workspaces), 5 pure utility-функцій із юніт-тестами:

| Файл | Що тестується |
| --- | --- |
| `slugify.mjs` | Нормалізація рядків (regex, trim, truncate) |
| `url-parse.mjs` | Query-string parse/build (decodeURIComponent, edge cases) |
| `retry.mjs` | Async retry з exponential backoff |
| `promise-pool.mjs` | Concurrent map зі збереженням порядку |
| `currency.mjs` | Cents-format, add, percent (integer math, NaN handling) |

## Як запустити

```bash
cd benchmarks/runner-comparison/demo && bun install
cd .. && bun run.mjs
```

Або один сценарій:

```bash
bun run.mjs --scenario=full-vitest
```

## Сценарії

| Сценарій | Опис |
| --- | --- |
| `full-bun` | Чистий прогін з `stryker.bun.config.mjs`; `demo/reports/` видаляється перед стартом. |
| `full-vitest` | Чистий прогін з `stryker.vitest.config.mjs`; `demo/reports/` видаляється. |
| `incremental-vitest-noop` | Другий прогін `stryker.vitest.config.mjs` БЕЗ очищення `reports/` — має бути ~миттєвим завдяки `incremental.json`. |

## Output

- `results/<scenario>-<ts>.json` — per-run метрики (durationMs, totalMutants, killed/survived/timeout/score, версії runtime).
- `results/<scenario>-<ts>.log` — повний stdout+stderr Stryker.
- `SPIKE.md` — агрегаційна таблиця, generated на кожному запуску `run.mjs`.

## Decision gate

- **Strong win**: `full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest` → рекомендую міграцію canonical baseline у `@nitra/cursor`.
- **Marginal**: speedup 1.25×–2× → треба додатковий `touch-1-source` сценарій перед рішенням.
- **No win**: speedup < 1.25× → не мігруємо.

## NOT scope

Цей бенчмарк **не** змінює нічого у `npm/rules/test/...` чи `npm/rules/js-lint/...`. Канонічний baseline `@nitra/cursor` залишається `bun test` поки spike не підтвердить виграш.
