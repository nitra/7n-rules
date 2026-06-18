---
type: ADR
title: "Міграція канонічного Stryker baseline на vitest runner з coverageAnalysis perTest"
---

# Міграція канонічного Stryker baseline на vitest runner з coverageAnalysis perTest

**Status:** Accepted
**Date:** 2026-05-26

## Context and Problem Statement

Канонічний Stryker baseline `@nitra/cursor` використовував `command` runner (bun test + concurrency:1 + inPlace:true). Підозра на виграш у швидкості при переході на `vitest` runner з `coverageAnalysis: 'perTest'` ще не була підтверджена цифрами; крім того, `inPlace:true` спричиняв hoisted-node_modules-проблему у Bun monorepo.

## Considered Options

- Зберегти `command` runner, лише підвищити concurrency
- Ізольований spike-бенчмарк із gate-порогом, далі — повна міграція на vitest runner (якщо gate пройдено)

## Decision Outcome

Chosen option: "Spike-перед-міграцією, потім vitest runner з coverageAnalysis: 'perTest'", because брифінг явно вказував на gate; spike підтвердив 31×–57× speedup на ідентичному mutation score 88.6%; `perTest` дозволяє Stryker запускати лише тести, що покривають конкретний рядок; `vitest-runner` ізолює мутантів AST-патчем у пам'яті, прибираючи потребу в `inPlace:true`.

### Consequences

- Good, because повний мутаційний прогін ~20 мутантів скорочується з ~20 хв до ~20 секунд; incremental dev-цикл ≈2.4s.
- Good, because прибирається hoisted-node_modules-проблема у Bun monorepo.
- Bad, because concern тепер копіює два файли (`stryker.config.mjs` + `vitest.config.js`) замість одного, що ускладнює onboarding.

## More Information

- `benchmarks/runner-comparison/` — ізольований standalone spike (НЕ у root workspaces), commit `d5ea36c`; сценарії: `full-bun` (≈562s), `full-vitest` (≈18s), `incremental-vitest-noop` (≈2.4s)
- `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs` → vitest + perTest
- `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` (новий canonical vitest config)
- `npm/rules/test/js/stryker_config.mjs` — concern копіює обидва baseline-и ідемпотентно
- `npm/rules/js-lint/coverage/coverage.mjs` — `detect()` шукає `vitest` у deps; `runJsCoverage()` → `bunx vitest run --coverage`
- `npm/rules/test/test.mdc` v2.3 → v2.4 — нові розділи: Vitest baseline + Frontend-варіант (Vue/Vite + happy-dom)
- `npm/rules/test/policy/package_json/template/package.json.contains.json` + `package_json_test.rego` — вимога `scripts.test` містить `"vitest"`
- Commit `328b89c`; версія npm `1.27.0`; 507 rego-тестів pass; 1142/1147 unit-тестів pass
- Пов'язане рішення (та сама сесія): заміна `@anthropic-ai/claude-code` → `@anthropic-ai/claude-agent-sdk` для усунення PATH-shadow у Zed (Node 26 TypeError у bundled `google-auth-library`); commit `7767778`, версія `1.27.2`
