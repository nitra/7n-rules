---
type: ADR
title: "Міграція канонічного Stryker baseline на vitest-runner із verify-first spike"
---

# Міграція канонічного Stryker baseline на vitest-runner із verify-first spike

**Status:** Accepted
**Date:** 2026-05-26

## Context and Problem Statement

Канонічний Stryker baseline `@nitra/cursor` використовував `command` runner (bun test + concurrency:1 + inPlace:true); повний мутаційний прогін займав ~20 хвилин. Потенційний виграш від `vitest` runner не був підтверджений цифрами. Додатково: `capture-decisions.sh` повертав `empty response from LLM CLI` у Zed через PATH-shadow — `node_modules/.bin/claude` (`@anthropic-ai/claude-code@1.0.128`) перехоплював homebrew `claude 2.1.142` і падав з `TypeError` на Node 26 (`util.inherits(X, require('stream'))` видалено у Node 26).

## Considered Options

* Повна міграція runner'а одразу без spike
* Ізольований spike-бенчмарк із gate-порогом, потім рішення
* Залишити `@anthropic-ai/claude-code`, прописати абсолютний шлях у хуку
* Замінити на `@anthropic-ai/claude-agent-sdk` у `package.json#dependencies`

## Decision Outcome

Chosen option: "Ізольований spike → vitest-міграція + заміна claude-code на claude-agent-sdk", because spike підтвердив 31×–57× speedup при ідентичному mutation score 88.6%; `claude-agent-sdk` прибирає PATH-shadow повністю без зміни сигнатури API `query()`.

### Consequences

* Good, because повний прогін ~20 мутантів: ~20 хв → ~20 с; incremental dev-цикл — ≈2.4s.
* Good, because `perTest` запускає лише тести, що покривають конкретний рядок; `vitest-runner` ізолює AST-патчем у пам'яті (не потрібен `inPlace:true`).
* Good, because після заміни dep `echo "say ok" | claude -p` відповідає `ok` замість TypeError.
* Bad, because concern копіює два файли (`stryker.config.mjs` + `vitest.config.js`) замість одного.

## More Information

Spike (`benchmarks/runner-comparison/`, commit `d5ea36c`, не у root workspaces):
- `full-bun` ≈562s, `full-vitest` ≈18s, `incremental-noop` ≈2.4s
- Gate: `full-vitest ≤ 0.5×full-bun` + `incremental ≤ 0.1×full-vitest` → виконані

Vitest-міграція (commit `328b89c`, version `1.27.0`):
- `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs` → vitest + perTest
- `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` (новий)
- `npm/rules/test/js/stryker_config.mjs` — копіює обидва baseline-и ідемпотентно
- `npm/rules/js-lint/coverage/coverage.mjs` — `detect()` шукає `vitest`; `runJsCoverage()` → `bunx vitest run --coverage`
- `npm/rules/test/test.mdc` v2.3 → v2.4
- `package_json_test.rego` — вимога `scripts.test` містить `"vitest"`
- 507/507 rego PASS; 1142/1147 unit PASS

Claude agent SDK (commit `7767778`, version `1.27.2`):
- `npm/package.json`: `"@anthropic-ai/claude-code": "^1.0.0"` → `"@anthropic-ai/claude-agent-sdk": "^0.3.0"`
- `npm/scripts/coverage-fix.mjs`: єдине місце SDK-виклику; тіло без змін
