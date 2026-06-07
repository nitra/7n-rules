---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T06:34:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

## ADR resolveModel() каскадний fallback для 6-тирної моделі

## Context and Problem Statement
Проєкт визначає 6 тирів моделей через env-змінні (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`). Споживачі (docgen, fix, coverage-fix, dispatcher) звертались до цих констант напряму, без будь-якого fallback: якщо локальна модель не налаштована — константа порожня, і код або падав, або вибирав неправильний рівень.

## Considered Options
* Додати helper `resolveModel(tier)` з явним каскадом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати helper `resolveModel(tier)` з явним каскадом", because прозора деградація без змін у споживачах — якщо `LOCAL_MIN` відсутній, система прозоро підіймається до наступного тиру.

Каскад зафіксований у `npm/lib/models.mjs`:
- `resolveModel('min')` → `LOCAL_MIN || LOCAL_AVG || LOCAL_MAX || CLOUD_MIN`
- `resolveModel('avg')` → `LOCAL_AVG || LOCAL_MAX || CLOUD_AVG`
- `resolveModel('max')` → `LOCAL_MAX || CLOUD_MAX`

### Consequences
* Good, because transcript фіксує очікувану користь: усі 5 споживачів (`docgen-gen.mjs`, `llm-worker.mjs`, `coverage-fix.mjs`, `subagent-runner.mjs`, `coverage-classify/index.mjs`) замінені на `resolveModel()` без зміни поведінки у вже налаштованих середовищах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ключові файли: `npm/lib/models.mjs` (функція і header-коментар з каскадом), `npm/skills/docgen/js/docgen-gen.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/scripts/coverage-classify/index.mjs`. Env-змінні: `N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`.

---

## ADR docgen Tier 1: pi orchestrated замість прямого ollama HTTP

## Context and Problem Statement
Docgen Tier 1 (файли з `internalSymbols.length < 4`) генерував документацію через прямі streaming HTTP-запити до `localhost:11434/api/chat` (функції `ollamaChat`, `generateOrchestrated`, `withTimeout`). Цей транспорт не є provider-нейтральним, містить ~142 рядки власної HTTP-логіки і не може використовувати `resolveModel()`.

## Considered Options
* Залишити прямий ollama HTTP (поточна реалізація)
* Замінити на pi one-shot (один виклик `pi` на весь документ)
* Замінити на pi orchestrated (окремий виклик `pi` на кожну секцію через `sectionMessages`)

## Decision Outcome
Chosen option: "Замінити на pi orchestrated", because pi one-shot спричинив регресію якості (score 100→65–75, систематично відсутній `## Огляд`), а pi orchestrated відновив якість до рівня прямого ollama HTTP при збереженні provider-нейтральності.

Реалізація: `sectionMessages()` із `docgen-prompts.mjs` повертає `{key, messages:[{role,content}], numPredict}`; для кожної секції messages конвертуються у plain-text prompt і передаються у `spawnSync('pi', ['-p', prompt, '--model', model, '--no-session', '--mode', 'text', '--no-tools'])`.

### Consequences
* Good, because transcript фіксує очікувану користь: код скорочується на ~142 рядки (видалені `node:http`, `ollamaChat`, `withTimeout`, `generateOrchestrated`); Tier 1 тепер проходить через `resolveModel('min')` і підтримує будь-який provider.
* Bad, because бенчмарк на 7 файлах показує: pi orchestrated на 15–50s повільніший за прямий ollama HTTP (discover-check-rules: 71s vs 44s; trufflehog: 61s vs 47s); також виявлено, що стара реалізація тримає Node.js event loop живим 5 хвилин після завершення генерації через `withTimeout` (`setTimeout(5min)` не знімається після `Promise.race`).

## More Information
Файл реалізації: `npm/skills/docgen/js/docgen-gen.mjs`. Backup NEW-версії під час бенчмарку: `/tmp/docgen-gen-new.mjs`. Допоміжна функція `assemble(stem, sections)` будує фінальний Markdown з секцій у порядку `overview → behavior → api → guarantees`. Часткові дані бенчмарку OLD vs NEW (pi orchestrated, `ollama/gemma3:4b`, 7 файлів):

| file | OLD ms | OLD score | NEW pi-orch ms | NEW pi-orch score |
|---|---|---|---|---|
| discover-check-rules.mjs | 38993 | 100 | 71000 | 100 |
| cache.mjs | 71932 | 100 | — | — |
| timing-summary.mjs | 36007 | 100 | — | — |
| check-reporter.mjs | 39553 | 90 | — | — |
| run-lint-step.mjs | 49874 | 100 | — | — |
| trufflehog.mjs | 95962 | 80 | 61000 | 90 |

Бенчмарк Phase 2 (pi orchestrated на всіх 12 файлах) не завершений через нестабільність ollama під час тривалого запуску. Scorer: `npm/skills/docgen/js/det-scorer.mjs` (`scoreDoc`). Штрафи: `no-overview` −25, `short-behavior` −20, `cache-hallucination` −20, `internal-name` −10.
