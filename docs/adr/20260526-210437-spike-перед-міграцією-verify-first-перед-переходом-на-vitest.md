---
session: 21e669d1-1834-437f-9026-66c8f7d2a895
captured: 2026-05-26T21:04:37+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/21e669d1-1834-437f-9026-66c8f7d2a895.jsonl
---

---

Нижче — MADR-документація за сесію. Сесія містила **три** незалежні дизайнові рішення.

---

## ADR Spike-перед-міграцією: verify-first перед переходом на Vitest runner

## Context and Problem Statement
Стояло питання міграції канонічного Stryker baseline `@nitra/cursor` з `command` runner (bun test + concurrency:1 + inPlace) на `vitest` runner з `coverageAnalysis: 'perTest'`. Потенційний виграш (швидкість мутаційного тестування) ще не був підтверджений цифрами, тому залишалось невідомим, чи варто взагалі чіпати `rules/test/js/` та пов'язані провайдери.

## Considered Options
* Виконати повну міграцію одразу (варіант B — «все в одному заході»)
* Зробити ізольований spike-бенчмарк із gate-порогом, і лише потім вирішувати (варіант A)

## Decision Outcome
Chosen option: "Ізольований spike-бенчмарк спочатку (варіант A)", because фраза у брифінгу «потім змінювати якщо дає виграш» явно вказувала на gate; spike дешевший, ніж повна міграція, яка може виявитись непотрібною.

### Consequences
* Good, because transcript фіксує очікувану користь: числа підтверджені двічі (31×–57× speedup, ідентичний mutation score 88.6%), і лише після цього команда дала go на фазу 2.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `benchmarks/runner-comparison/` — ізольований standalone-проєкт (НЕ у root workspaces), commit `d5ea36c`
- Сценарії: `full-bun` (≈562s), `full-vitest` (≈18s), `incremental-vitest-noop` (≈2.4s)
- `run.mjs` → JSON-артефакти у `results/`, автоматично оновлює `SPIKE.md`
- Порогові критерії: `full-vitest ≤ 0.5 × full-bun` + `incremental ≤ 0.1 × full-vitest` → усі виконані

---

## ADR Міграція канонічного Stryker baseline на vitest-runner з perTest

## Context and Problem Statement
Після підтвердження spike (31×–57× speedup) канонічний Stryker baseline `@nitra/cursor` потребував оновлення: `command` runner + `bun test` + `concurrency:1` + `inPlace:true` → `vitest` runner + `coverageAnalysis: 'perTest'` + default concurrency. Разом з baseline мали оновитись concern `stryker_config.mjs`, coverage-провайдер `js-lint/coverage/coverage.mjs`, документація `test.mdc` і policy-template `package.json.contains.json`.

## Considered Options
* Зберегти `command` runner, лише підвищити concurrency
* Перейти на `vitest` runner з `coverageAnalysis: 'perTest'`

## Decision Outcome
Chosen option: "vitest runner з coverageAnalysis: 'perTest'", because spike довів 31×–57× speedup на ідентичному mutation score; `perTest` дозволяє Stryker запускати лише ті тести, що покривають конкретний рядок, а `vitest-runner` ізолює мутантів AST-патчем у пам'яті (прибираючи потребу в `inPlace:true` та вирішуючи hoisted-node_modules-проблему у Bun monorepo).

### Consequences
* Good, because transcript фіксує очікувану користь: повний мутаційний прогін ~20 мутантів у споживача зменшується з ~20 хв до ~20 секунд; incremental dev-цикл — ≈2.4s (Stryker startup overhead).
* Bad, because concern тепер копіює два файли замість одного (`stryker.config.mjs` + `vitest.config.js`), що ускладнює onboarding.

## More Information
- A. `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs` → vitest + perTest
- A. Новий `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` (canonical vitest config)
- B. `npm/rules/test/js/stryker_config.mjs` — concern копіює обидва baseline-и ідемпотентно
- C. `npm/rules/js-lint/coverage/coverage.mjs` — `detect()` шукає `vitest` у deps; `runJsCoverage()` → `bunx vitest run --coverage`
- D. `npm/rules/test/test.mdc` v2.3 → v2.4 — нові розділи: Vitest baseline + Frontend-варіант (Vue/Vite + happy-dom)
- E. `npm/rules/test/policy/package_json/template/package.json.contains.json` + `package_json_test.rego` — додана вимога `scripts.test` містить `"vitest"`
- Commit `328b89c`, версія npm `1.27.0`; усі 507 rego-тестів pass; 1142/1147 unit-тестів pass (3 pre-existing fail — Bun 1.3 EventEmitter mock-issue + v8r timeout)

---

## ADR Заміна claude-code v1 на claude-agent-sdk для усунення PATH-shadow у Zed

## Context and Problem Statement
Хук `capture-decisions.sh` у `.claude/hooks/` завжди повертав `empty response from LLM CLI`: subprocess шукав `claude` через PATH, але Zed Claude Agent додає `./node_modules/.bin` перед системним PATH, через що subprocess брав локальний `@anthropic-ai/claude-code@1.0.128` замість homebrew `claude 2.1.142`. Версія 1.0.128 падає з `TypeError: Cannot read properties of undefined (reading 'prototype')` на Node v26 (google-auth-library bundled code, `util.inherits(X, require('stream'))` — API видалено у Node 26). Результат: ADR-чернетки не створювались.

## Considered Options
* Залишити `@anthropic-ai/claude-code@^1.0.0` і прописати у хуку абсолютний шлях `/opt/homebrew/bin/claude`
* Замінити `@anthropic-ai/claude-code` на `@anthropic-ai/claude-agent-sdk` у `npm/package.json#dependencies`

## Decision Outcome
Chosen option: "Замінити dep на claude-agent-sdk", because це single-source-of-truth fix: прибирає `node_modules/.bin/claude` shadow повністю, не псує canonical скрипта хука при наступному `npx @nitra/cursor fix adr`, і SDK API `query()` — ідентичний (prompt, options, AsyncGenerator<SDKMessage> — без змін сигнатури).

### Consequences
* Good, because transcript фіксує очікувану користь: після `rm node_modules/@anthropic-ai/claude-code` + `bun install` `type -a claude` показує лише `/opt/homebrew/bin/claude`; `echo "say ok" | claude -p` відповідає `ok` (раніше TypeError).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/package.json`: `"@anthropic-ai/claude-code": "^1.0.0"` → `"@anthropic-ai/claude-agent-sdk": "^0.3.0"`
- `npm/scripts/coverage-fix.mjs`: `import('@anthropic-ai/claude-code')` → `import('@anthropic-ai/claude-agent-sdk')` (єдине місце SDK-виклику; тіло без змін)
- Версія `@anthropic-ai/claude-agent-sdk` = 0.3.150; `query({ prompt, options })` → `AsyncGenerator<SDKMessage>` — сумісно з попередньою сигнатурою v1
- Причина TypeError у v1: `google-auth-library` у bundled `cli.js:386` викликає `util.inherits(X, require('stream'))` — у Node 26 `require('stream')` не є функцією-конструктором в очікуваному контексті
- Commit `7767778`, версія npm `1.27.2`
