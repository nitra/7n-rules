# Vitest Runner Spike — Results

Generated: 2026-05-26T16:48:36.599Z

## Numbers

| Сценарій                | Мутантів | Час    | Score | Speedup vs full-bun |
| ----------------------- | -------- | ------ | ----- | ------------------- |
| full-bun                | 158      | 562.6s | 88.6% | 1.00×               |
| full-vitest             | 158      | 17.9s  | 88.6% | 31.39×              |
| incremental-vitest-noop | 158      | 2.4s   | 88.6% | 234.31×             |

## Environment

- Node: 24.3.0
- Bun: 1.3.14

## Decision criteria

- **Strong win** (рекомендую міграцію): `full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest`
- **Marginal**: 0.5×–0.8× → треба `touch-1-source` сценарій
- **No win**: > 0.8× → не мігруємо

## Reproduce

```bash
cd benchmarks/runner-comparison && bun run.mjs
```
