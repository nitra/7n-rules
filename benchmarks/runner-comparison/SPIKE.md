# Vitest Runner Spike — Results

Generated: 2026-05-26T15:01:44.771Z

## Numbers

| Сценарій | Мутантів | Час | Score | Speedup vs full-bun |
| --- | --- | --- | --- | --- |
| full-bun | 158 | 572.2s | 88.6% | 1.00× |
| full-vitest | 158 | 10.0s | 88.6% | 57.19× |
| incremental-vitest-noop | 158 | 2.2s | 88.6% | 262.60× |

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
