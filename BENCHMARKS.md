# Benchmarks

## Stryker runner migration (1.27.0)

Canonical Stryker baseline у `@nitra/cursor` перейшов з `command` runner + `bun test` на `vitest` runner + `coverageAnalysis: 'perTest'`. Рішення базується на verify-first спайку (158 мутантів на 5 pure-функціях).

### Results

| Сценарій                                              | Час    | Мутантів | Score | Speedup  |
| ----------------------------------------------------- | ------ | -------- | ----- | -------- |
| `full-bun` (command + concurrency:1 + inPlace)        | 562.6s | 158      | 88.6% | 1.00×    |
| `full-vitest` (vitest + perTest, concurrency default) | 17.9s  | 158      | 88.6% | **31×**  |
| `incremental-vitest-noop` (другий прогін без змін)    | 2.4s   | 158      | 88.6% | **234×** |

Run-to-run jitter повного vitest-прогону: 10–18 с (порядково стабільний). Mutation score ідентичний на обох ранерах → міграція не змінює correctness, лише швидкість.

Прогнозований ефект на проєктах-споживачах (наприклад app/ з 142 мутантами + `bun test --parallel`-baseline ~20 хв): ~20 секунд для повного, секунди для incremental dev-циклу.

### Як відтворити

```bash
bun run benchmark
```

(скрипт викликає `bun benchmarks/runner-comparison/run.mjs` — повний прогін всіх 3 сценаріїв ~10 хв, бо `full-bun` baseline домінує).

Raw artifacts:

- `benchmarks/runner-comparison/SPIKE.md` — auto-generated таблиця після кожного прогону.
- `benchmarks/runner-comparison/results/<scenario>-<ts>.json` — per-run метрики.
- `benchmarks/runner-comparison/results/<scenario>-<ts>.log` — повний stdout+stderr Stryker.
- `benchmarks/runner-comparison/README.md` — методологія, склад demo-проєкту.

У CI не запускається — повільно через baseline `full-bun` (10 хв). Локально — за потреби.
