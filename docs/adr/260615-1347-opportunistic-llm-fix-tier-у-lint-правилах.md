---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T13:47:07+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Opportunistic LLM-fix tier у lint-правилах

## Context and Problem Statement
`doc-files` — єдиний lint-крок, чий `fix`-бік вимагає локальної LLM (`omlx`). Через це він свідомо працював як detect-only у `lint()`, а генерація виносилась в окрему команду `fix-doc-files`. Паралельно існуючий `cspell-fix.mjs` намагався виправляти spelling-знахідки через whole-file rewrite (unbounded output), що на реальних файлах цього репо приводило до таймаутів 120 с, parse-fail і memory-guard reject. Постало питання: чи можна уніфікувати підхід «opportunistic LLM-fix, якщо `omlx` піднято» як спільний patтерн для всіх lint-правил.

## Considered Options
* Лишити `lint()` detect-only для `doc-files`, зберегти whole-file `llmLintFix` для cspell
* Opportunistic-fix у `lint()`: якщо `omlx` up — фіксить, якщо down — skip + exit 1 (гейт тримається); cspell — classify → append словник, а не whole-file rewrite
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Opportunistic-fix tier як спільний патерн із двома outcome-формами (`apply` та `suggest`)", because (a) `doc-files` lint-крок отримав opportunistic-generate: `readOnly` → detect, `omlx` down → skip + exit 1, `omlx` up → `runGenerationBatch` → re-detect; (b) cspell-fix замінено з whole-file apply (unbounded output, timeout/parse-fail) на classify → append `.cspell.json` (bounded, безпечно); (c) спільне ядро `preflightLocalModel(model)` винесено в `npm/lib/llm.mjs` і ділиться між обома правилами.

### Consequences
* Good, because transcript фіксує очікувану користь: нова cspell-схема дала 79 валідних слів у `.cspell.json` за один bounded omlx-виклик замість 25 whole-file regenerations із таймаутами.
* Good, because принцип «bounded output» усуває клас відмов (timeout 120 с, parse-fail, memory-guard reject) на великих файлах.
* Bad, because тестова герметичність `lint.test.mjs` для `doc-files` порушилась при використанні `vi.fn()+mockReset` із dynamic-import (другий фантомний виклик з `undefined`); розв'язано через стабільний mock-wrapper із мутабельним `state.impl`.

## More Information
Змінені файли: `npm/rules/doc-files/js/lint.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/text/lint/cspell-fix.mjs`, `npm/lib/llm.mjs`, `npm/rules/doc-files/meta.json`, `npm/schemas/rule-meta.json`. Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Changesets: `npm/.changes/260615-0907.md` (doc-files lint opportunistic-fix, minor), `npm/.changes/260615-1315.md` (cspell whole-file→classify-dict, minor), `npm/.changes/260615-1344.md` (shared `preflightLocalModel`, patch). Тріаж безпеки: логічні лінтери (eslint/oxlint) залишено поза `llmFix` — LLM-правка коду може змінити поведінку; opt-in прапор `meta.json: llmFix:true`. Виміряно наживо: 1406 cspell-знахідок / 292 файли — ~90% валідні укр/тех-слова (кандидати у словник), а не одруки.
