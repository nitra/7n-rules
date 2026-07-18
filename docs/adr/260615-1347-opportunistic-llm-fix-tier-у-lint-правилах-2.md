---
type: ADR
title: Opportunistic LLM-fix tier у lint-правилах
description: Lint-правила з безпечними content-fix сценаріями отримують opportunistic LLM-fix через локальну модель із bounded output і чесним gate.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

`doc-files` був lint-кроком, який у fix-by-default режимі лише детектував застарілу документацію і делегував генерацію в окремий `fix-doc-files`, бо генерація потребує локальної LLM (`omlx`). Це створювало асиметрію з іншими lint-правилами, які у fix-режимі реально виправляють порушення.

Паралельно `cspell-fix.mjs` використовував whole-file rewrite через LLM: модель отримувала весь файл і мала повернути виправлений файл. На реальних файлах репозиторію transcript фіксує timeout 120 с, parse-fail і memory-guard reject, бо output зростав разом із input. Експеримент із cspell також показав, що більшість знахідок — валідні українські або технічні слова, тобто кандидати у словник, а не одруки.

Потрібне спільне правило: коли lint може безпечно залучати локальну LLM для content-fix, як не ламати `--read-only`/CI контракт і як уникати unbounded LLM-відповідей.

## Considered Options

- Лишити `doc-files` detect-only у `lint()`, а cspell — на whole-file `llmLintFix`.
- Opportunistic-fix у `lint()`: якщо `omlx` доступний — виконувати безпечний fix, якщо недоступний — skip + exit 1; для cspell замінити whole-file rewrite на classify → append словника.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Opportunistic-fix у `lint()` із bounded output для LLM-стратегій", because transcript фіксує, що `doc-files` може зберегти CI-контракт через `readOnly` gate, а cspell whole-file rewrite операційно ламається на реальних файлах; classify → `.cspell.json` відповідає фактичній природі знахідок і не мутує джерельні файли.

Для `doc-files` lint-контракт стає таким: `readOnly` → detect-only; `omlx` down → повідомлення про пропущений fix і exit 1; `omlx` up → `runGenerationBatch` → re-detect. Для LLM-fix правил opt-in задається через `meta.json: llmFix: true`. Для cspell whole-file rewrite заборонено як unbounded output; стратегія має класифікувати unknown words і додавати валідні слова до `.cspell.json`, а typo лишати на review.

### Consequences

- Good, because fix-by-default lint стає самодостатнім для `doc-files`, коли локальна модель доступна, а `--read-only`/CI лишається deterministic detect-only.
- Good, because cspell переходить від unbounded whole-file rewrite із timeout/parse-fail до bounded classify-виклику і словникового remediation.
- Good, because `llmFix: true` робить LLM-fix explicit opt-in для content-лінтерів.
- Bad, because lint-крок у fix-by-default режимі стає side-effecting і залежним від локальної `omlx` інфраструктури.
- Bad, because LLM-класифікація cspell може помилятися; transcript містить приклад шкідливої класифікації `аутейдж` → `аудит`, тому typo auto-apply не дозволено.
- Neutral, because transcript не містить підтвердження, що логічні лінтери можуть безпечно використовувати LLM-fix; eslint/oxlint залишаються поза scope.

## More Information

- `doc-files`: `npm/rules/doc-files/js/lint.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/meta.json`, `npm/schemas/rule-meta.json`.
- cspell/text: `npm/rules/text/lint/cspell-fix.mjs`, `npm/rules/text/lint/tests/cspell-fix.test.mjs`, `.cspell.json`.
- Shared/preflight: transcript згадує винесення `preflightLocalModel(model)` у `npm/lib/llm.mjs`.
- Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.
- Changesets у transcript: `npm/.changes/260615-0907.md`, `npm/.changes/260615-1308.md`, `npm/.changes/260615-1315.md`, `npm/.changes/260615-1344.md`.
- Виміряні факти transcript: cspell мав 1406 знахідок у 292 файлах; більшість — валідні українські або технічні слова; whole-file rewrite давав timeout 120 с або parse-fail; classify→dict додавав десятки валідних слів у `.cspell.json` без мутації source-файлів.

## Update 2026-06-15

- Додатково зафіксовано контракт `doc-files` lint: `readOnly` → detect-only; `omlx` up → `runGenerationBatch(stale, cwd)` → re-detect; `omlx` down → повідомлення про пропущений fix і exit 1.
- `runGenerationBatch` і `preflightProblem` винесено в exports `docgen-files-batch.mjs`; `meta.json` отримує `llmFix: true` як opt-in.
- Паралельне рішення про видалення `lint-ci` і `doc-files <sub>` уже покрите clean ADR `260615-0641-видалення-надлишкових-cli-точок-входу-lint-ci-і-doc-files-sub.md`.

## Update 2026-06-15

- Уточнено, що `doc-files` і `cspell` не мають бути двома незалежними LLM-fix реалізаціями: потрібна одна абстракція з preflight, route model, circuit-breaker і cap.
- Єдиний knob для LLM-fix tier — `N_LOCAL_MIN_MODEL`; попередній `N_CURSOR_FIX_MODEL` для cspell визнано розбіжністю, яку треба прибрати.
- Експеримент `bunx cspell .` показав 1406 знахідок у 292 файлах; більшість — валідні українські або технічні слова, тобто словникові кандидати, а не одруки.

## Update 2026-06-15

- Для `doc-files` явно зафіксовано ризик PostToolUse convergence-loop: у fix-by-default режимі lint може автоматично регенерувати документи при кожному збереженні, якщо `omlx` доступний.
- Реалізація тестів потребувала stable mock-wrapper для dynamic import, щоб уникнути нестабільності `vi.fn` + `mockReset`.

## Update 2026-06-15

- Додано уточнення для cspell: LLM-fix має працювати у quick-scope для змінених файлів, бо full-scope дає багато валідних словникових знахідок і не є практичним автоматичним fix-сценарієм.
- Для safety triage підтверджено: `llmFix:true` допустимий для content-лінтерів (`doc-files`, `cspell`), але не для логічних лінтерів на кшталт eslint/oxlint.

## Update 2026-06-15

- Зафіксовано cspell-стратегію `classify+dict-suggest`: whole-file apply (`llmLintFix`) відхилено через timeout 120 с, parse error і unbounded output на реальних файлах.
- Обрана форма для cspell: класифікувати unknown words, валідні додавати у `.cspell.json`, typo залишати як список для review.
- Негативний приклад із transcript: класифікатор помилково запропонував `аутейдж` → `аудит`, тому typo auto-apply не дозволено.

## Update 2026-06-15

- Для cspell сформульовано інваріант: LLM-fix strategy мусить мати bounded output; переписування всього файлу через LLM — заборонений анти-патерн.
- Нові/очікувані публічні helper-и для text/cspell: `unknownWords(output)`, `appendWordsToDict(words, cfgPath)`, `runCspellText(files, cwd, {readOnly})`.
- Словник `.cspell.json` має оновлюватися sorted + dedup.

## Update 2026-06-15

- Живий результат cspell classify→dict: близько 2–5 секунд замість 15–30 хвилин timeout-сценарію; десятки валідних слів додано в `.cspell.json`; джерельні файли не мутуються.
- Зафіксовано changeset для cspell-переходу: `.changes/260615-1308.md`.
- Для `doc-files` підтверджено 131/131 тестів після переходу на opportunistic-fix.

## Update 2026-06-15

- Додатковий результат cspell: re-detect після додавання словникових слів дає 0 знахідок на scope; ймовірні одруки не застосовуються автоматично, а виносяться на review.
- При `omlx` down cspell-знахідки лишаються, gate не зеленіє; ручне додавання слів у словник лишається fallback.

## Update 2026-06-15

- Зафіксовано принцип bounded output для LLM-fix стратегій: стратегія не має повертати весь вхідний файл; допустимі форми — bounded artifact (`apply`) або bounded JSON suggestions (`suggest`).
- `cspell-fix` замінено з whole-file `llmLintFix` на classify → `.cspell.json`: модель класифікує обмежений набір distinct-слів, `valid` дописуються у словник, `typo` лишаються списком на ревʼю.
- Спільний preflight локальної моделі винесено в `npm/lib/llm.mjs` як `preflightLocalModel(model)` і використано в `docgen-files-batch.mjs` та `cspell-fix.mjs`.
- `meta.json: llmFix:true` став реальним opt-in: `orchestrate.mjs` читає `metaById[id]?.llmFix` і передає `{ readOnly, llmFix }` у правила; правила без прапора лишаються detect-only.
